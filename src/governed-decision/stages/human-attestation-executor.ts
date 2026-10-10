/**
 * W-E5 / B.S3 — Human attestation executor.
 *
 * Records that the approving human attested the approved `human_attest` ops.
 * Also records co-present `document_record` ops on mixed adopted plans
 * (Router may select human-attestation as primary — W-E4 priority).
 * Performs NO filesystem or SCM mutation. Refuses any other op kind.
 */

import type { ExecutableOperation } from "../types.js";
import type { DeterministicExecutor, ExecutorOutcome } from "./execution.js";

export type HumanAttestationExecutorOptions = {
  /** Clerk user id (or equivalent) of the human who ratified. */
  readonly attestorId: string;
  /** ISO timestamp of the attestation act (ratify moment). */
  readonly attestedAt?: string;
};

export function makeHumanAttestationExecutor(
  options: HumanAttestationExecutorOptions,
): DeterministicExecutor {
  const attestorId = options.attestorId.trim();
  const attestedAt = options.attestedAt ?? new Date().toISOString();

  return (approvedOps: readonly ExecutableOperation[]): ExecutorOutcome => {
    const results: Array<ExecutorOutcome["results"][number]> = [];
    const ranOps: ExecutableOperation[] = [];

    for (const op of approvedOps) {
      if (op.kind === "human_attest") {
        if (attestorId.length === 0) {
          results.push({
            op: { ...op },
            status: "failed",
            detail: "attestor identity required",
          });
          continue;
        }
        ranOps.push({ ...op });
        results.push({
          op: { ...op },
          status: "ran",
          detail: `attested by ${attestorId} at ${attestedAt}: ${op.statement}`,
        });
        continue;
      }
      if (op.kind === "document_record") {
        // Mixed adopted plan: human is primary Router kind; still record
        // co-approved document tasks without FS/SCM mutation (W-E6).
        if (attestorId.length === 0) {
          results.push({
            op: { ...op },
            status: "failed",
            detail: "recorder identity required",
          });
          continue;
        }
        ranOps.push({ ...op });
        results.push({
          op: { ...op },
          status: "ran",
          detail: `document recorded by ${attestorId} at ${attestedAt}: ${op.statement}`,
        });
        continue;
      }
      results.push({
        op: { ...op },
        status: "failed",
        detail:
          "human-attestation executor refuses FS/SCM ops (no filesystem actuation)",
      });
    }

    return {
      ranOps,
      results,
      // Attestation is a recorded human act at a wall-clock moment — not a
      // pure function of inputs alone.
      deterministic: false,
    };
  };
}
