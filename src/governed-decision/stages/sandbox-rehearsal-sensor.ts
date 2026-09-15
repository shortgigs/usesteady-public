/**
 * W-W2 — Sandbox rehearsal sensor (F1a).
 *
 * Zero-authority: copies approved ops into a per-rehearsal temp dir under the
 * server-resolved sandbox root, runs the fs executor + fs reality probe, records
 * results, then deletes the temp dir. Never mutates the real workspace or SCM.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutableOperation, ExecutionPayload, UnderstandingPayload } from "../types.js";
import { makeSandboxedFsExecutor } from "./fs-executor.js";
import { makeFsRealityProbe } from "./fs-reality-probe.js";

export type RehearsalOpResult = {
  readonly kind: string;
  readonly path: string;
  readonly status: string;
};

export type SandboxRehearsalEvidence =
  | {
      readonly status: "connected";
      readonly rehearsedAt: string;
      readonly sandboxPath: string;
      readonly opResults: readonly RehearsalOpResult[];
      readonly probeVerdict: "agree" | "disagree" | "unknown";
      readonly detail: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
    };

export function isRehearsalEnabled(): boolean {
  return process.env["GOVERNED_REHEARSAL"] === "1";
}

function mapOpResults(
  results: readonly { op: ExecutableOperation; status: string }[],
): RehearsalOpResult[] {
  return results.map((r) => ({
    kind: r.op.kind,
    path: r.op.path,
    status: r.status,
  }));
}

/**
 * Rehearse approved ops in a disposable sandbox under `sandboxRoot`.
 * READ/WRITE only inside the temp dir — real workspace is never touched.
 */
export function senseSandboxRehearsal(input: {
  readonly sandboxRoot: string;
  readonly ops: readonly ExecutableOperation[];
}): SandboxRehearsalEvidence {
  if (input.ops.length === 0) {
    return { status: "unavailable", reason: "No executable operations to rehearse." };
  }

  let tempDir: string;
  try {
    tempDir = mkdtempSync(join(input.sandboxRoot, ".rehearsal-"));
  } catch (e) {
    return {
      status: "unavailable",
      reason: `Could not create rehearsal temp dir: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    const executor = makeSandboxedFsExecutor(tempDir);
    const outcome = executor(input.ops);
    const executionPayload: ExecutionPayload = {
      ranWhatWasApproved:
        outcome.ranOps.length === input.ops.length &&
        outcome.ranOps.every((op, i) => op.kind === input.ops[i]!.kind && op.path === input.ops[i]!.path),
      deterministic: outcome.deterministic,
      steps: outcome.ranOps.map((op) => op.kind + ": " + op.path),
      results: outcome.results,
    };
    const probe = makeFsRealityProbe(tempDir);
    const probeResult = probe(executionPayload);
    const verdict = probeResult.realityVerdict;

    return {
      status: "connected",
      rehearsedAt: new Date().toISOString(),
      sandboxPath: tempDir,
      opResults: mapOpResults(outcome.results),
      probeVerdict: verdict,
      detail:
        verdict === "agree"
          ? "Rehearsed OK in disposable sandbox — not verified against production reality."
          : verdict === "disagree"
            ? "Rehearsal probe disagreed with executor in sandbox."
            : "Rehearsal completed; probe had nothing to verify.",
    };
  } catch (e) {
    return {
      status: "unavailable",
      reason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Extract executable ops from a stored draft record for rehearsal. */
export function rehearsalOpsFromRecord(record: {
  readonly understanding: {
    readonly status: string;
    readonly value?: UnderstandingPayload;
  };
}): readonly ExecutableOperation[] {
  if (record.understanding.status !== "connected" || !record.understanding.value) return [];
  const ops: ExecutableOperation[] = [];
  for (const plan of record.understanding.value.candidatePlans) {
    if (plan.operation !== undefined) ops.push(plan.operation);
  }
  return ops;
}
