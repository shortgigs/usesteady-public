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
import { type BoundarySink } from "../execution/boundary-observer.js";
import type { ExecutionReplayVerdict } from "./types.js";
import type { WorkflowTaskSpec } from "../workflow/types.js";
export type TaskReplayOutcome = {
    readonly kind: "accepted";
} | {
    readonly kind: "failed";
    readonly errorCode: string | null;
};
export declare function executeStructuredReplace(spec: WorkflowTaskSpec, workspaceRoot: string): TaskReplayOutcome;
export declare function executeRunCommand(spec: WorkflowTaskSpec, workspaceRoot: string): TaskReplayOutcome;
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
export declare function runExecutionReplay(artifactPath: string, opts?: {
    sink?: BoundarySink;
}): Promise<ExecutionReplayVerdict>;
//# sourceMappingURL=execution-replay.d.ts.map