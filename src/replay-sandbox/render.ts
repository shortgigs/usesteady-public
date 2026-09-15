/**
 * Compose ReplaySandboxBundle from certified inspect + execution snapshot (read-only).
 * @see docs/product/executor-replay-execution-sandbox-contract-v1.md
 */

import { createHash } from "node:crypto";

import { buildReplayInspectionBundle } from "../executor/observability/build-replay-inspection-bundle.js";
import type { ReplayInspectionBundle } from "../executor/observability/types.js";
import type { WorkerResultRecord } from "../executor/worker/types.js";
import {
  REPLAY_SANDBOX_POLICY_REFERENCE,
  REPLAY_SANDBOX_VERSION,
} from "./constants.js";
import {
  deriveExecutionRecordSnapshot,
  reconstructReplaySandbox,
} from "./reconstruct.js";
import {
  replaySandboxBundleId,
  replaySandboxEnvelopeId,
} from "./replay-id.js";
import type {
  ReplayAuditRecord,
  ReplayExecutionSandboxSurface,
  ReplayIsolationStatus,
  ReplaySandboxBundle,
  ReplaySandboxCheck,
  ReplaySandboxEnvelope,
  ReplaySandboxProjection,
  ReplaySandboxStatus,
} from "./types.js";
import { ReplaySandboxRejectedError } from "./types.js";

const V1_SURFACES: readonly ReplayExecutionSandboxSurface[] = [
  "replay_candidate_summary",
  "determinism_checks",
  "drift_comparison",
  "replay_safety_boundary_checks",
  "replay_audit_lineage",
  "replay_isolation_status",
];

const stagedHashesByJob = new Map<string, string>();

export function resetReplaySandboxStagingForTests(): void {
  stagedHashesByJob.clear();
}

export type BuildReplaySandboxBundleInput = {
  readonly worker_result: WorkerResultRecord;
  readonly now?: Date;
};

function resolveSandboxStatus(
  inspect: ReplayInspectionBundle,
  replay_state: string,
): ReplaySandboxStatus {
  if (inspect.projection.inspectability_status === "unavailable") {
    return "unavailable";
  }
  if (replay_state === "blocked" || replay_state === "expired") {
    return "partial";
  }
  if (inspect.projection.inspectability_status === "partial") {
    return "partial";
  }
  return "available";
}

function resolveIsolationStatus(
  envelope: ReplaySandboxEnvelope,
): ReplayIsolationStatus {
  if (envelope.non_authoritative !== true) return "unavailable";
  if (envelope.envelope_status === "isolated") return "isolated";
  return "partial";
}

function buildChecks(input: {
  readonly inspect: ReplayInspectionBundle;
  readonly candidate_id: string;
  readonly lineage_hash: string;
  readonly replay_reference: string;
  readonly source_job_id: string;
  readonly observed_at: string;
  readonly prior_staged_hash?: string;
}): readonly ReplaySandboxCheck[] {
  const inspectRef = input.inspect.projection.inspect_bundle_reference;
  const evidence_ref = `worker_result:${input.source_job_id}`;
  const rule = `${REPLAY_SANDBOX_VERSION}/INV-RSB`;

  const determinismMaterial = [
    ...input.inspect.payload.trace.source_record_refs,
    ...(input.inspect.payload.timeline?.entries.map((e) => e.record_ref) ?? []),
    ...input.inspect.payload.decision_history.entries.map((e) => e.lineage_reference),
  ].sort();
  const materialDigest = createHash("sha256")
    .update(JSON.stringify(determinismMaterial))
    .digest("hex");
  const digestMatch = materialDigest === input.lineage_hash;

  const checks: ReplaySandboxCheck[] = [
    {
      check_id:        `chk-determinism-${input.candidate_id.slice(0, 12)}`,
      kind:            "determinism",
      label:           "Lineage digest aligns with inspect lineage_hash",
      surface:         "determinism_checks",
      evidence_ref,
      projection_ref:  inspectRef,
      policy_reference: REPLAY_SANDBOX_POLICY_REFERENCE,
      observed_at:     input.observed_at,
      rule_reference:  `${rule}-2`,
      pass:            digestMatch,
      note:            digestMatch
        ? "Inspect lineage_hash matches ordered material digest."
        : "Material digest mismatch (visibility only — no re-execution).",
    },
    {
      check_id:        `chk-boundary-${input.candidate_id.slice(0, 12)}`,
      kind:            "safety_boundary",
      label:           "Replay reference is inspect-scoped",
      surface:         "replay_safety_boundary_checks",
      evidence_ref,
      projection_ref:  inspectRef,
      policy_reference: REPLAY_SANDBOX_POLICY_REFERENCE,
      observed_at:     input.observed_at,
      rule_reference:  `${rule}-8`,
      pass:            input.replay_reference.length > 0,
      note:            "Inspect ≠ execute; sandbox ≠ production.",
    },
    {
      check_id:        `chk-isolation-${input.candidate_id.slice(0, 12)}`,
      kind:            "isolation",
      label:           "Sandbox envelope is non-authoritative",
      surface:         "replay_isolation_status",
      evidence_ref,
      projection_ref:  `sandbox:${input.candidate_id}`,
      policy_reference: REPLAY_SANDBOX_POLICY_REFERENCE,
      observed_at:     input.observed_at,
      rule_reference:  `${rule}-5`,
      pass:            true,
      note:            "non_authoritative: true",
    },
  ];

  if (input.prior_staged_hash !== undefined) {
    checks.push({
      check_id:        `chk-drift-${input.candidate_id.slice(0, 12)}`,
      kind:            "drift",
      label:           "Candidate lineage_hash vs prior staged hash",
      surface:         "drift_comparison",
      evidence_ref,
      projection_ref:  inspectRef,
      policy_reference: REPLAY_SANDBOX_POLICY_REFERENCE,
      observed_at:     input.observed_at,
      rule_reference:  `${rule}-drift`,
      pass:            input.prior_staged_hash === input.lineage_hash,
      note:
        input.prior_staged_hash === input.lineage_hash
          ? "No drift vs prior staged candidate."
          : "Drift detected vs prior staged candidate (visibility only).",
    });
  }

  return checks;
}

function buildAuditRecords(input: {
  readonly checks: readonly ReplaySandboxCheck[];
  readonly candidate_id: string;
  readonly envelope_id: string;
  readonly observed_at: string;
  readonly source_job_id: string;
}): readonly ReplayAuditRecord[] {
  const records: ReplayAuditRecord[] = [
    {
      audit_id:         `audit-stage-${input.candidate_id.slice(0, 12)}`,
      candidate_id:     input.candidate_id,
      envelope_id:      input.envelope_id,
      event_kind:       "candidate_staged",
      evidence_ref:     `worker_result:${input.source_job_id}`,
      projection_ref:   `sandbox:${input.candidate_id}`,
      policy_reference: REPLAY_SANDBOX_POLICY_REFERENCE,
      observed_at:      input.observed_at,
      rule_reference:     `${REPLAY_SANDBOX_VERSION}/stage`,
      note:             "Staging only — no production execution.",
    },
  ];

  for (const check of input.checks) {
    const kind =
      check.kind === "determinism"
        ? "determinism_checked"
        : check.kind === "drift"
          ? "drift_compared"
          : check.kind === "safety_boundary"
            ? "boundary_checked"
            : "isolation_verified";
    records.push({
      audit_id:         check.check_id.replace("chk-", "audit-"),
      candidate_id:     input.candidate_id,
      envelope_id:      input.envelope_id,
      event_kind:       kind,
      evidence_ref:     check.evidence_ref,
      projection_ref:   check.projection_ref,
      policy_reference: check.policy_reference,
      observed_at:      check.observed_at,
      rule_reference:   check.rule_reference,
      ...(check.note !== undefined ? { note: check.note } : {}),
    });
  }

  return records;
}

/**
 * Build full replay sandbox bundle — inspect path mandatory, execution snapshot for candidate.
 */
export function buildReplaySandboxBundle(
  input: BuildReplaySandboxBundleInput,
): ReplaySandboxBundle {
  const now = input.now ?? new Date();
  const generated_at = now.toISOString();
  const job_id = input.worker_result.job_id;

  const inspect = buildReplayInspectionBundle({
    worker_result: input.worker_result,
    now,
  });

  if (inspect.projection.inspectability_status === "unavailable") {
    throw new ReplaySandboxRejectedError(
      "replay_sandbox_projection_rejected",
      "Replay inspection could not be composed — sandbox fails closed.",
    );
  }

  const execution = deriveExecutionRecordSnapshot(input.worker_result);
  if (execution === undefined) {
    throw new ReplaySandboxRejectedError(
      "replay_sandbox_projection_rejected",
      "Execution snapshot could not be derived from worker evidence.",
    );
  }

  const candidate = reconstructReplaySandbox({ execution });
  const candidate_id = candidate.replay_sandbox_id;
  const lineage_hash = inspect.projection.lineage_hash;
  const prior_staged_hash = stagedHashesByJob.get(job_id);
  stagedHashesByJob.set(job_id, lineage_hash);

  const envelope_id = replaySandboxEnvelopeId({
    replay_sandbox_id: candidate_id,
    replay_version:    REPLAY_SANDBOX_VERSION,
  });

  const envelope: ReplaySandboxEnvelope = {
    envelope_id,
    candidate_id,
    isolation_token:      `isolated:${envelope_id.slice(0, 16)}`,
    sandbox_workspace_ref: `sandbox://non-prod/${job_id}`,
    envelope_status:      "isolated",
    non_authoritative:    true,
    created_at:           generated_at,
  };

  const checks = buildChecks({
    inspect,
    candidate_id,
    lineage_hash,
    replay_reference: inspect.projection.replay_reference,
    source_job_id:    job_id,
    observed_at:      generated_at,
    ...(prior_staged_hash !== undefined ? { prior_staged_hash } : {}),
  });

  const audit_records = buildAuditRecords({
    checks,
    candidate_id,
    envelope_id,
    observed_at:  generated_at,
    source_job_id: job_id,
  });

  const sandbox_status = resolveSandboxStatus(inspect, candidate.replay_state);
  const isolation_status = resolveIsolationStatus(envelope);

  const projection: ReplaySandboxProjection = {
    sandbox_id:               replaySandboxBundleId({
      source_job_id:     job_id,
      replay_sandbox_id: candidate_id,
      replay_version:    REPLAY_SANDBOX_VERSION,
    }),
    source_job_id:            job_id,
    inspect_bundle_reference: inspect.projection.inspect_bundle_reference,
    candidate_reference:      candidate_id,
    envelope_reference:       envelope_id,
    check_count:              checks.length,
    audit_count:              audit_records.length,
    sandbox_status,
    isolation_status,
    created_at:               generated_at,
  };

  const unavailable_reason =
    sandbox_status === "unavailable"
      ? "Sandbox unavailable — inspect lineage not composable."
      : sandbox_status === "partial"
        ? "Partial sandbox — candidate or inspect lineage is incomplete; simulation metadata only."
        : undefined;

  return {
    bundle_id:    projection.sandbox_id,
    generated_at,
    projection,
    candidate,
    envelope,
    surfaces:     V1_SURFACES,
    checks,
    audit_records,
    ...(unavailable_reason !== undefined ? { unavailable_reason } : {}),
  };
}
