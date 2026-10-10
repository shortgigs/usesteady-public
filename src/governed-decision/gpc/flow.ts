/**
 * End-to-end GPC confirmation: seal → project → probe → memory.
 */

import { CapsuleLedger } from "./ledger.js";
import { materializeProjection } from "./materialize.js";
import { capsuleLedgerPathForSandbox } from "./paths.js";
import { probeProjection } from "./probe.js";
import { sealCapsule } from "./seal.js";
import {
  contentAddress,
  type ApprovedPlanStub,
  type GpcWireStatus,
  type ProjectionBackend,
  type VerifiedProjectionRecord,
} from "./types.js";

export type RunGpcInput = {
  readonly plan: ApprovedPlanStub;
  readonly backend: ProjectionBackend;
  /** Server-local sandbox root (sandbox_fs) or projections parent (ephemeral_fs). */
  readonly localRoot: string;
  /** Opaque workspace_key when using sandbox_fs. */
  readonly workspaceKey?: string;
  /** Override ledger path (tests). Default: <sandbox>/capsules/capsule-ledger.jsonl */
  readonly ledgerPath?: string;
};

export type RunGpcResult = GpcWireStatus & {
  /** Server-local only — for probes / certs; omit from Portal wire when possible. */
  readonly local_projection_root: string;
  readonly probe_matches: boolean;
  readonly ledger_path: string;
};

/**
 * 1. Seal capsule (refuses without approval_seal)
 * 2. Append to ledger
 * 3. Materialize projection
 * 4. Independent reality probe
 * 5. Append VerifiedProjectionRecord
 */
export function runGovernedProjectionCapsule(input: RunGpcInput): RunGpcResult {
  const sealedAt = new Date().toISOString();
  const capsule = sealCapsule(input.plan, sealedAt);

  const ledgerPath =
    input.ledgerPath?.trim() ||
    (input.backend === "sandbox_fs"
      ? capsuleLedgerPathForSandbox(input.localRoot)
      : `${input.localRoot.replace(/[/\\]+$/, "")}/capsule-ledger.jsonl`);

  const ledger = new CapsuleLedger(ledgerPath);
  ledger.appendCapsule(capsule);

  const materialized = materializeProjection(capsule, input.backend, {
    ...(input.backend === "ephemeral_fs"
      ? { projectionsRoot: input.localRoot }
      : {
          sandboxRoot: input.localRoot,
          workspaceKey: input.workspaceKey ?? "ws_unknown",
        }),
  });

  const strictExtra = input.backend === "ephemeral_fs";
  const probe = probeProjection(
    capsule,
    materialized.localRoot,
    materialized.receipt.projection_key,
    { strictExtraFiles: strictExtra },
  );

  const verifiedAt = new Date().toISOString();
  const status = probe.matches_capsule ? "verified" : "rejected";
  const recordPayload = {
    capsule_id: capsule.capsule_id,
    projection_key: materialized.receipt.projection_key,
    target: materialized.receipt.target,
    observed_digests: probe.observed_digests,
    status,
  };
  const record: VerifiedProjectionRecord = {
    record_id: contentAddress(recordPayload),
    capsule_id: capsule.capsule_id,
    projection_key: materialized.receipt.projection_key,
    target: materialized.receipt.target,
    verified_at: verifiedAt,
    observed_digests: probe.observed_digests,
    status,
    note: probe.matches_capsule
      ? ""
      : `mismatch=${JSON.stringify(probe.mismatch_paths)}`,
    ...(input.workspaceKey ? { workspace_key: input.workspaceKey } : {}),
  };
  ledger.appendVerified(record);

  return {
    capsule_id: capsule.capsule_id,
    projection_key: materialized.receipt.projection_key,
    claimed_root_label: materialized.receipt.claimed_root_label,
    verified_record_id: record.record_id,
    status,
    backend: materialized.receipt.target,
    workspace_key: input.workspaceKey ?? "",
    local_projection_root: materialized.localRoot,
    probe_matches: probe.matches_capsule,
    ledger_path: ledgerPath,
  };
}

/**
 * Lookup capsule + latest verified record (Portal / cert visibility).
 * Wire response never includes absolute paths.
 */
export function lookupGpcStatus(input: {
  readonly ledgerPath: string;
  readonly capsuleId: string;
}): {
  readonly capsule_id: string;
  readonly sealed: boolean;
  readonly verified_record_id: string | null;
  readonly status: "verified" | "rejected" | "sealed_only" | "unknown";
  readonly projection_key: string | null;
  readonly workspace_key: string | null;
} {
  const ledger = new CapsuleLedger(input.ledgerPath);
  const capsule = ledger.getCapsule(input.capsuleId);
  if (capsule === null) {
    return {
      capsule_id: input.capsuleId,
      sealed: false,
      verified_record_id: null,
      status: "unknown",
      projection_key: null,
      workspace_key: null,
    };
  }
  const verified = ledger.listVerified(input.capsuleId);
  const latest = verified.length > 0 ? verified[verified.length - 1]! : null;
  if (latest === null) {
    return {
      capsule_id: input.capsuleId,
      sealed: true,
      verified_record_id: null,
      status: "sealed_only",
      projection_key: null,
      workspace_key: null,
    };
  }
  return {
    capsule_id: input.capsuleId,
    sealed: true,
    verified_record_id: latest.record_id,
    status: latest.status,
    projection_key: latest.projection_key,
    workspace_key: latest.workspace_key ?? null,
  };
}
