/**
 * In-memory execution evidence for observability read paths (no mutation).
 */

import type { WorkerResultRecord } from "../worker/types.js";

export type ExecutionEvidenceBundle = {
  readonly worker_result: WorkerResultRecord;
  readonly stored_at: string;
};

const evidenceByJobId = new Map<string, ExecutionEvidenceBundle>();

export function storeExecutionEvidence(
  job_id: string,
  bundle: ExecutionEvidenceBundle,
): void {
  evidenceByJobId.set(job_id.trim(), bundle);
}

export function getExecutionEvidence(job_id: string): ExecutionEvidenceBundle | undefined {
  const hit = evidenceByJobId.get(job_id.trim());
  return hit === undefined ? undefined : hit;
}

export function resetExecutionEvidenceStoreForTests(): void {
  evidenceByJobId.clear();
}

export function seedExecutionEvidenceForTests(bundle: ExecutionEvidenceBundle): void {
  evidenceByJobId.set(bundle.worker_result.job_id, bundle);
}

/** Newest-first evidence bundles for observability list (read-only, bounded). */
export function listExecutionEvidenceBundles(): readonly ExecutionEvidenceBundle[] {
  return [...evidenceByJobId.values()].sort((a, b) =>
    b.stored_at.localeCompare(a.stored_at),
  );
}
