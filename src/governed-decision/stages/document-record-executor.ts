/**
 * W-E6 / B.S4 — Document-record executor.
 *
 * Records that an approved document-class Candidate Plan task was recorded
 * at ratify time. Performs NO filesystem or SCM mutation. Refuses any other
 * op kind (fail closed).
 */

import type { ExecutableOperation } from "../types.js";
import type { DeterministicExecutor, ExecutorOutcome } from "./execution.js";

export type DocumentRecordExecutorOptions = {
  /** Clerk user id (or equivalent) of the human who ratified. */
  readonly recorderId: string;
  /** ISO timestamp of the record act (ratify moment). */
  readonly recordedAt?: string;
};

export function makeDocumentRecordExecutor(
  options: DocumentRecordExecutorOptions,
): DeterministicExecutor {
  const recorderId = options.recorderId.trim();
  const recordedAt = options.recordedAt ?? new Date().toISOString();

  return (approvedOps: readonly ExecutableOperation[]): ExecutorOutcome => {
    const results: Array<ExecutorOutcome["results"][number]> = [];
    const ranOps: ExecutableOperation[] = [];

    for (const op of approvedOps) {
      if (op.kind !== "document_record") {
        results.push({
          op: { ...op },
          status: "failed",
          detail:
            "document-record executor refuses non-document ops (no FS/SCM actuation)",
        });
        continue;
      }
      if (recorderId.length === 0) {
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
        detail: `document recorded by ${recorderId} at ${recordedAt}: ${op.statement}`,
      });
    }

    return {
      ranOps,
      results,
      deterministic: false,
    };
  };
}
