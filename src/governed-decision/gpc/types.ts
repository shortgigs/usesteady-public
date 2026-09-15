/**
 * Governed Projection Capsules (GPC) — types.
 *
 * Wire-facing ids are opaque (`capsule_id`, `projection_key`, `workspace_key`).
 * Never put client absolute paths on the wire (INV-WS-1 spirit).
 *
 * Architecture V1: seal only after H approval; Evidence probes independently.
 */

import { createHash } from "node:crypto";

/** Stable content-address: SHA-256 of sorted-key JSON. */
export function contentAddress(obj: unknown): string {
  return createHash("sha256")
    .update(stableStringify(obj), "utf8")
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

/**
 * Human-approved plan stub for sealing. Binding a workspace is NOT enough —
 * approval_seal must be non-empty (H sole authority).
 */
export type ApprovedPlanStub = {
  readonly plan_id: string;
  readonly intent_summary: string;
  /** Relative path → file body (create_file). */
  readonly artifacts: Readonly<Record<string, string>>;
  /** Relative directory paths (create_dir). */
  readonly dirs?: readonly string[];
  readonly policy_seals?: readonly string[];
  /** H authority token — typically approved_plan_hash. */
  readonly approval_seal: string;
  readonly approved_by?: string;
};

export type Capsule = {
  readonly capsule_id: string;
  readonly plan_id: string;
  readonly intent_summary: string;
  readonly artifact_digests: Readonly<Record<string, string>>;
  readonly artifact_bodies: Readonly<Record<string, string>>;
  readonly dirs: readonly string[];
  readonly policy_seals: readonly string[];
  readonly approval_seal: string;
  readonly sealed_at: string;
};

export type ProjectionBackend = "sandbox_fs" | "ephemeral_fs" | "github_branch";

export type ProjectionReceipt = {
  readonly capsule_id: string;
  readonly target: ProjectionBackend;
  readonly projection_key: string;
  /** Opaque label — never a client absolute path. */
  readonly claimed_root_label: string;
  readonly claimed_digests: Readonly<Record<string, string>>;
};

export type RealityProbeResult = {
  readonly capsule_id: string;
  readonly projection_key: string;
  readonly observed_digests: Readonly<Record<string, string>>;
  readonly matches_capsule: boolean;
  readonly mismatch_paths: readonly string[];
};

export type VerifiedProjectionRecord = {
  readonly record_id: string;
  readonly capsule_id: string;
  readonly projection_key: string;
  readonly target: ProjectionBackend;
  readonly verified_at: string;
  readonly observed_digests: Readonly<Record<string, string>>;
  readonly status: "verified" | "rejected";
  readonly note: string;
  /** Opaque workspace_key when Hybrid D sandbox was the projection backend. */
  readonly workspace_key?: string;
};

export type GpcWireStatus = {
  readonly capsule_id: string;
  readonly projection_key: string;
  readonly claimed_root_label: string;
  readonly verified_record_id: string;
  readonly status: "verified" | "rejected";
  readonly backend: ProjectionBackend;
  readonly workspace_key: string;
};

export function requireHumanApproval(plan: ApprovedPlanStub): void {
  if (!plan.approval_seal.trim()) {
    throw new Error(
      "bind_is_not_approve: Capsule requires non-empty approval_seal (H is sole approval authority)",
    );
  }
}

export function sha256Utf8(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}
