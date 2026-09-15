/**
 * Kernel v1 / K4 — execution replay orchestrator.
 *
 * ── Scope (PR-K4 design lock §7, §8) ─────────────────────────────────────────
 *
 *   `runExecutionReplay(artifactPath)` — implements the deferred replay
 *   path that PR-K1 (#239) explicitly punted. Sequential, single-threaded,
 *   fail-fast. Driven entirely by the artifact and the deterministic K4
 *   modules (classifier, sandbox, result-equality).
 *
 *   Control flow (verbatim from design §7):
 *     1. Read + parse artifact file.                  [throws on I/O / shape → exit 2]
 *     2. Run K1 runReplay() for integrity.            [mismatch → throw → exit 2]
 *                                                     (K4-I4: never execute a tampered artifact)
 *     3. classifyForReplay(artifact.ir).
 *        non_replayable → return refused verdict.    [exit 3, no sandbox created]
 *     4. createSandbox().                             [mkdtempSync under os.tmpdir()]
 *     5. try {
 *          a. Build the FS plugin (CursorInProcessAdapter scoped to sandbox).
 *          b. Walk ir.tasks, executing each via the FS-op fast path.
 *          c. Build a fresh KernelResult from the captured outcomes.
 *          d. Compare new KernelResult to artifact.result.
 *          e. Build the ExecutionReplayVerdict.
 *        } finally {
 *          f. cleanupSandbox.                         [best-effort; errors → stderr]
 *        }
 *
 *   ── Hard invariants (K4-I1..I10, design §4) ────────────────────────────────
 *
 *     - K4-I3: this module never accepts `workspaceRoot` from the caller.
 *              The sandbox path is computed inside this function and never
 *              escapes back to the verdict, the artifact, or any persisted file.
 *     - K4-I4: integrity check (runReplay) precedes execution. mismatch aborts.
 *     - K4-I6: NO LLM / cursor / claude session pipeline is constructed.
 *              Only the FsPlugin surface of CursorInProcessAdapter is used.
 *     - K4-I7: kernel.v1 artifact shape is read but never written or modified.
 *     - K4-I9: sandbox cleanup is in `finally`. Process crash is the only way
 *              a sandbox can leak; the prefix "usesteady-replay-" makes leaks
 *              greppable.
 *     - K4-I10: refusal is per-IR. classifyForReplay short-circuits before
 *              any sandbox is created.
 *
 *   ── No-shell-import boundary (design §6.1) ─────────────────────────────────
 *
 *     This module deliberately does NOT import from `src/shell/`. The CLI
 *     wires `--execute` into use-steady.ts; that file imports this module,
 *     not the other way around.
 */

import { spawnSync }                                          from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, dirname }                          from "node:path";

import { runReplay }                  from "./replay.js";
import { classifyForReplay, isContainedRelativePath } from "./classifier.js";
import { classifyInScopeCommand, isReplayableCommandShape } from "./command-classifier.js";
import { createSandbox, cleanupSandbox } from "./sandbox.js";
import { kernelResultsEqual }         from "./result-equality.js";
import { finalizeErrorCode }          from "./error-codes.js";
import { CursorInProcessAdapter }     from "../cursor/adapters/inprocess-adapter.js";
import {
  makeBoundaryJsonlSink,
  makeReplayFsBoundaryObserver,
  observeInvocation,
  type BoundarySink,
}                                     from "../execution/boundary-observer.js";
import { resolveStoreDir }            from "../shell/defaults.js";

import type {
  KernelArtifact,
  KernelResult,
  ExecutionReplayVerdict,
} from "./types.js";
import type {
  WorkflowSpec,
  WorkflowTaskSpec,
  FsChange,
  FsPlugin,
} from "../workflow/types.js";
import { bindEffectiveFsChange } from "../input/effective-resource.js";

// ─── Per-task replay outcome ─────────────────────────────────────────────────
//
// Mirrors WorkflowTaskOutcome's "accepted" | <failure> distinction without
// dragging in the full coordinator state machine. The K4 executor only
// needs two terminal states per task: accepted, or failed-with-code.
//
// @internal — exported solely for the structuredReplace drift test
// (`tests/kernel/structuredReplace-drift.test.ts`). Not part of the
// public kernel surface; do not import from outside `src/kernel/` or
// `tests/kernel/`.

export type TaskReplayOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "failed"; readonly errorCode: string | null };

// ─── FsChange builder for replayable specs ───────────────────────────────────
//
// The classifier already proved every spec is replayable; this just maps
// the spec into the FsChange shape the FsPlugin expects. Mirrors
// `buildFsChangeFromSpec` in src/workflow/coordinator.ts (intentionally
// duplicated to keep the kernel layer free of coordinator imports).

function buildFsChangeForReplay(spec: WorkflowTaskSpec): FsChange | undefined {
  switch (spec.operationType) {
    case "create_dir":
      return spec.targetFiles?.[0]
        ? { operationType: "create_dir", dirPath: spec.targetFiles[0] }
        : undefined;
    case "write_file":
      return spec.targetFiles?.[0] !== undefined && spec.content !== undefined
        ? { operationType: "write_file", filePath: spec.targetFiles[0], content: spec.content }
        : undefined;
    case "append_file":
      return spec.targetFiles?.[0] !== undefined && spec.content !== undefined
        ? { operationType: "append_file", filePath: spec.targetFiles[0], content: spec.content }
        : undefined;
    case "prepend_file":
      return spec.targetFiles?.[0] !== undefined && spec.content !== undefined
        ? { operationType: "prepend_file", filePath: spec.targetFiles[0], content: spec.content }
        : undefined;
    case "rename":
      return spec.targetFiles?.[0] !== undefined && spec.newPath !== undefined
        ? { operationType: "rename", filePath: spec.targetFiles[0], newPath: spec.newPath }
        : undefined;
    case "delete_file":
      return spec.targetFiles?.[0]
        ? { operationType: "delete_file", filePath: spec.targetFiles[0] }
        : undefined;
    default:
      // structuredReplace is handled out-of-band (no FsChange variant).
      return undefined;
  }
}

// ─── structuredReplace executor ──────────────────────────────────────────────
//
// Mirrors the production cursor adapter's replace path
// (src/cursor/adapters/inprocess-adapter.ts:209-282) using the same error
// codes so a successful production run reproduces in the sandbox without
// drift in `KernelResult.error`.
//
// Drift between this inline implementation and the production adapter's
// replace path is structurally guarded by
// `tests/kernel/structuredReplace-drift.test.ts`. That test pins the
// overlap matrix — `{accepted, file_not_found, old_value_not_found,
// ambiguous_match}` — between this function and
// `CursorInProcessAdapter.receive()`. The production adapter has
// additional refusal modes (scope, canonicalization, replacement-safety,
// symlinks, filename safety, workspace containment) that are intentionally
// unreachable in K4's fresh sandbox — those are defense-in-depth
// differences, not drift.
//
// @internal — exported solely for the drift test. Not part of the public
// kernel surface; consumers should call `runExecutionReplay`, not this
// function directly.

export function executeStructuredReplace(
  spec:          WorkflowTaskSpec,
  workspaceRoot: string,
): TaskReplayOutcome {
  const sr = spec.structuredReplace;
  if (!sr) return { kind: "failed", errorCode: "invalid_op" };

  // Defense-in-depth: the classifier already rejected any non-contained
  // path, but we re-check here so the sandbox guarantee survives any
  // future refactor of the classifier. K4-I3 does not depend on a
  // single check site.
  if (!isContainedRelativePath(sr.filePath)) {
    return { kind: "failed", errorCode: "invalid_op" };
  }

  const abs = isAbsolute(sr.filePath) ? sr.filePath : join(workspaceRoot, sr.filePath);

  if (!existsSync(abs)) {
    return { kind: "failed", errorCode: "file_not_found" };
  }

  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return { kind: "failed", errorCode: "merge_conflict" };
  }

  const firstIndex = content.indexOf(sr.oldValue);
  if (firstIndex === -1) {
    return { kind: "failed", errorCode: "old_value_not_found" };
  }

  const lastIndex = content.lastIndexOf(sr.oldValue);
  if (lastIndex !== firstIndex) {
    return { kind: "failed", errorCode: "ambiguous_match" };
  }

  const updated = content.slice(0, firstIndex) + sr.newValue + content.slice(firstIndex + sr.oldValue.length);

  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, updated, "utf8");
  } catch {
    return { kind: "failed", errorCode: "merge_conflict" };
  }

  return { kind: "accepted" };
}

// === K5 + K6 run_command executor ===========================================
//
// Per-command strategy (K5 design v1.0 section 3 D3, section 7; K6 design
// v1.0 section 7):
//   - `echo <args>` runs via `spawnSync(<command>, { shell: true })`.
//     Cross-shell safe on every supported host.
//   - `true`  short-circuits to {accepted} without invoking any shell.
//   - `false` short-circuits to {failed,errorCode:"execution_error"} without
//     invoking any shell. cmd.exe lacks `true` and `false` as built-ins,
//     so a shell roundtrip would diverge cross-platform; the short-circuit
//     preserves the structural-determinism contract.
//   - `node -e "<BODY>"` runs via `spawnSync('node', ['-e', body],
//     { shell: false })`. CRITICAL: `shell: false` is mandatory -- it
//     bypasses every host shell entirely and hands the body string as a
//     single argv argument to the `node` binary. This is the K6-I8 hermetic
//     contract; running with `shell: true` here would let the host shell
//     re-interpret the BODY (e.g. cmd.exe argv quoting), defeating the
//     classifier's structural-determinism proof.
//
// Outcome mapping (K5-I14 / K6-I9):
//   - exitCode === 0 -> { kind: "accepted" }
//   - exitCode !== 0 -> { kind: "failed", errorCode: "execution_error" }
//
// K5-I16 / K6-I8 (hermetic): cwd is sandbox.path; PATH is inherited (the
// echo path needs PATH lookup; the node path needs PATH to find the `node`
// binary). stdout/stderr are captured by spawnSync but NEVER returned in
// the TaskReplayOutcome -- preserving K1's "no stdout/stderr in
// KernelResult" contract (K4-I8 lineage; K6-I7).
//
// @internal -- the K5+K6 executor seam. Exposed at module scope so tests
// can exercise it without going through `runExecutionReplay`, mirroring
// the `executeStructuredReplace` test seam pattern.

export function executeRunCommand(
  spec:          WorkflowTaskSpec,
  workspaceRoot: string,
): TaskReplayOutcome {
  const command = spec.command;

  // Defense-in-depth: the classifier already proved this is in scope, but
  // we re-check so the K5-I13 / K6-I4 contract survives any future refactor
  // of the classifier. The contract does not depend on a single check site.
  if (typeof command !== "string" || !isReplayableCommandShape(command)) {
    return { kind: "failed", errorCode: "invalid_op" };
  }

  const bucket = classifyInScopeCommand(command);

  // Discriminated dispatch -- TypeScript exhaustiveness enforces every
  // bucket variant is handled. K6 design doc section 13 / K6-I14.
  switch (bucket.kind) {
    case "true":
      return { kind: "accepted" };

    case "false":
      return { kind: "failed", errorCode: "execution_error" };

    case "echo": {
      // Run via shell. PATH inheritance is the only env coupling K5 accepts;
      // the allow-list guarantees the command is cross-shell safe.
      //
      // Bytes passed to spawnSync are the ORIGINAL `command` from the spec
      // (not the trimmed `bucket.command`) -- K6 v1.0 audit (PR #336) flagged
      // this as a byte-preservation nit. K5 alpha.59 spawned the raw command;
      // K6 v1.0 transiently spawned the trimmed form. Observable behavior is
      // identical across every supported host shell (all strip surrounding
      // whitespace before parsing), but the byte-for-byte K5 preservation
      // contract is restored here. `bucket.command` is intentionally not
      // referenced -- the discriminant carries it for tests / future
      // observability only.
      let exitCode: number | null;
      try {
        const proc = spawnSync(command, {
          cwd:          workspaceRoot,
          shell:        true,
          encoding:     "utf8",
          windowsHide:  true,
        });
        // spawnSync sets `status` to the exit code; null indicates a signal-
        // killed process or spawn failure. Treat null as failure for K5
        // determinism -- an `echo` invocation that did not produce a clean
        // exit code is no longer in the K5 deterministic universe.
        exitCode = proc.status;
      } catch {
        return { kind: "failed", errorCode: "execution_error" };
      }
      return exitCode === 0
        ? { kind: "accepted" }
        : { kind: "failed", errorCode: "execution_error" };
    }

    case "node_e": {
      // K6 path: spawn `node` directly with `-e` and the body as a single
      // argv argument. `shell: false` is the K6-I8 contract -- the host
      // shell is entirely bypassed so the BODY string is not subject to
      // shell re-quoting.
      //
      // Argv form: ['-e', body] (no shell parsing, no quoting concerns).
      let exitCode: number | null;
      try {
        const proc = spawnSync("node", ["-e", bucket.body], {
          cwd:          workspaceRoot,
          shell:        false,                       // K6-I8: NEVER shell:true
          encoding:     "utf8",
          windowsHide:  true,
        });
        exitCode = proc.status;
      } catch {
        return { kind: "failed", errorCode: "execution_error" };
      }
      return exitCode === 0
        ? { kind: "accepted" }
        : { kind: "failed", errorCode: "execution_error" };
    }
  }
}

// ─── Per-task dispatcher ─────────────────────────────────────────────────────
//
// Routes one WorkflowTaskSpec to either the FsPlugin (for the FS-op family),
// the inline structuredReplace executor, or the K5 run_command executor.
// All three paths return the same internal TaskReplayOutcome shape.

/**
 * Defense-in-depth path-containment check for an FsChange. Mirrors the
 * classifier's structural rule but applies at the boundary between K4 code
 * and the production FsPlugin (which short-circuits absolute paths). Any
 * future regression that lets an absolute or `..`-escaping path past the
 * classifier still fails here without touching the real workspace.
 */
function fsChangePathsAreContained(op: FsChange): boolean {
  switch (op.operationType) {
    case "create_dir":   return isContainedRelativePath(op.dirPath);
    case "write_file":
    case "append_file":
    case "prepend_file":
    case "delete_file":  return isContainedRelativePath(op.filePath);
    case "rename":       return isContainedRelativePath(op.filePath)
                              && isContainedRelativePath(op.newPath);
    case "run_command":  return false;  // run_command does not flow through this check; K5 has its own executor
  }
}

async function executeOneTask(
  spec:          WorkflowTaskSpec,
  plugin:        FsPlugin,
  workspaceRoot: string,
  sink?:         BoundarySink,
): Promise<TaskReplayOutcome> {
  // P2 completion: observe the spec AS RECEIVED by each replay-internal
  // execution function's entry boundary (observe-only, same reference
  // forwarded). A caller without a sink simply leaves no record — absence
  // means correspondence NOT ESTABLISHED at verification, never inferred.
  if (spec.structuredReplace && !spec.operationType) {
    if (sink) {
      return observeInvocation(
        executeStructuredReplace, sink, "replay_structured_replace.execute",
      )(spec, workspaceRoot);
    }
    return executeStructuredReplace(spec, workspaceRoot);
  }

  // K5 v1.0 §7 — run_command tasks take the K5 executor path, NOT the
  // FsPlugin path. The classifier has already verified the command is
  // in scope; executeRunCommand re-checks defensively.
  if (spec.operationType === "run_command") {
    if (sink) {
      return observeInvocation(
        executeRunCommand, sink, "replay_run_command.execute",
      )(spec, workspaceRoot);
    }
    return executeRunCommand(spec, workspaceRoot);
  }

  const op = buildFsChangeForReplay(spec);
  if (!op) {
    // Should not be reachable — the classifier rejected this case already.
    return { kind: "failed", errorCode: "invalid_op" };
  }
  if (!fsChangePathsAreContained(op)) {
    // Belt-and-suspenders: classifier already rejected this case.
    return { kind: "failed", errorCode: "invalid_op" };
  }

  // Replay is a new prepare/execute against the sandbox, not a bind
  // attached to a prior live approval.
  const bound = bindEffectiveFsChange(op, workspaceRoot);
  if (!bound.ok) {
    return { kind: "failed", errorCode: bound.code };
  }
  const result = await plugin.executeFsOp(bound.op);
  if (result.kind === "accepted") return { kind: "accepted" };
  return { kind: "failed", errorCode: result.errorCode ?? null };
}

// ─── KernelResult builder for the replay run ─────────────────────────────────
//
// Walks the per-task outcomes the executor captured and produces the same
// KernelResult shape the production CLI builds via buildKernelResultFromRun.
// Uses K2's finalizeErrorCode choke point so the canonical-code surface
// matches production exactly (K2's normalization is the single source of
// truth for what `KernelResult.error` may contain).

function buildReplayKernelResult(
  totalSteps: number,
  outcomes:   readonly TaskReplayOutcome[],
): KernelResult {
  const executed_steps = outcomes.filter(o => o.kind === "accepted").length;
  const failedIdx      = outcomes.findIndex(o => o.kind === "failed");
  const failed_at_step = failedIdx === -1 ? null : failedIdx + 1;

  const capturedErrorCode =
    failedIdx === -1 ? null : (outcomes[failedIdx] as { kind: "failed"; errorCode: string | null }).errorCode;

  const error = finalizeErrorCode({
    capturedErrorCode,
    capturedFailureNote: capturedErrorCode === null && failedIdx !== -1 ? "fs op failed" : null,
    skippedByIntake:     false,
  });

  return {
    success:        failedIdx === -1,
    error,
    executed_steps,
    failed_at_step,
    total_steps: totalSteps,
  };
}

// ─── Artifact load + shape guard ─────────────────────────────────────────────

function loadArtifact(artifactPath: string): KernelArtifact {
  const raw = readFileSync(artifactPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `kernel.execution-replay: artifact is not valid JSON (${artifactPath}): `
      + (err instanceof Error ? err.message : String(err)),
    );
  }
  if (!isArtifactShape(parsed)) {
    throw new Error(
      `kernel.execution-replay: artifact is missing required fields {ir, result, checksum} (${artifactPath})`,
    );
  }
  return parsed;
}

function isArtifactShape(value: unknown): value is KernelArtifact {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["checksum"] === "string"
    && typeof obj["ir"]    === "object" && obj["ir"]     !== null
    && typeof obj["result"]=== "object" && obj["result"] !== null
  );
}

// ─── Public entry: runExecutionReplay ────────────────────────────────────────

/**
 * K4 execution replay. Re-runs the IR in a fresh sandbox and compares the
 * resulting KernelResult to the artifact's stored result.
 *
 * Throws on:
 *   - artifact I/O failure or shape error (caller maps to exit 2)
 *   - K1 integrity mismatch on the artifact (K4-I4 — never execute a
 *     tampered artifact)
 *
 * Returns a discriminated `ExecutionReplayVerdict` for every other case
 * (match / mismatch / refused). The CLI maps the verdict to exit codes
 * 0 / 1 / 3 respectively.
 */
export async function runExecutionReplay(
  artifactPath: string,
  opts?: { sink?: BoundarySink },
): Promise<ExecutionReplayVerdict> {
  // Step 1: load the artifact (may throw → exit 2).
  const artifact = loadArtifact(artifactPath);

  // Step 2: K4-I4 integrity check (may throw → exit 2 if mismatch).
  // Reuses K1's runReplay verbatim so this code path observes the SAME
  // verdict consumers of `usesteady replay <file>` see.
  const integrity = runReplay(artifactPath);
  if (integrity.replay !== "match") {
    throw new Error(
      `kernel.execution-replay: refusing to execute a tampered artifact (`
      + `original_checksum=${integrity.original_checksum}, `
      + `new_checksum=${integrity.new_checksum})`,
    );
  }

  // Step 3: classify (K4-I10 — refusal is per-IR, before any sandbox).
  // K5 v1.0 §3 D5: the classifier's `reason` field is surfaced verbatim into
  // the verdict. Pre-K5 verdicts were always reason "non_deterministic_task";
  // K5 widens this to also include "non_deterministic_command" when the IR
  // contains an out-of-scope `run_command` task.
  const classification = classifyForReplay(artifact.ir as WorkflowSpec);
  if (classification.verdict === "non_replayable") {
    return {
      replay:            "refused",
      mode:              "execute",
      reason:            classification.reason ?? "non_deterministic_task",
      task_index:        classification.task_index,
      original_checksum: integrity.original_checksum,
      new_checksum:      null,
    };
  }

  // Step 4: fresh sandbox (K4-I3).
  const sandbox = createSandbox();

  try {
    // Step 5a: FS plugin scoped to the sandbox. NEVER the real workspace.
    // P2 completion: receiving-side boundary observation at the replay
    // adapter seam and at the replay-internal executor entries — observe-only,
    // same reference forwarded, distinct replay boundary identities.
    const sink = opts?.sink
      ?? makeBoundaryJsonlSink(join(resolveStoreDir(), "boundary-observations.jsonl"));
    const plugin: FsPlugin = makeReplayFsBoundaryObserver(
      new CursorInProcessAdapter(sandbox.path),
      sink,
    );

    // Step 5b: walk tasks fail-fast (PR-3 alignment; K4-I10 in spirit).
    const outcomes: TaskReplayOutcome[] = [];
    for (const task of artifact.ir.tasks) {
      const outcome = await executeOneTask(task, plugin, sandbox.path, sink);
      outcomes.push(outcome);
      if (outcome.kind === "failed") break;
    }

    // Step 5c: build fresh KernelResult.
    const replay_result = buildReplayKernelResult(artifact.ir.tasks.length, outcomes);

    // Step 5d: field-by-field comparison against stored result.
    const result_match = kernelResultsEqual(replay_result, artifact.result);

    // Step 5e: assemble verdict. Both `original_checksum` and
    // `new_checksum` carry the artifact's own checksum (computed in step 2);
    // `result_match` is the operative field that distinguishes execute-mode
    // match from mismatch.
    return {
      replay:            result_match ? "match" : "mismatch",
      mode:              "execute",
      original_checksum: integrity.original_checksum,
      new_checksum:      integrity.new_checksum,
      result_match,
      replay_result,
    };
  } finally {
    // Step 5f: K4-I9 — cleanup is best-effort but mandatory.
    cleanupSandbox(sandbox.path);
  }
}
