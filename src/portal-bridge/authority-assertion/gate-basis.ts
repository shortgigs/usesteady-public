/**
 * P1 Authority Assertion V1 — pending-approval gate decision basis (Core twin).
 *
 * Recomputes the exact basis the Portal signed from Core's own live gate input,
 * so a signed decision is bound to the gate content Core actually has open.
 * Must stay byte-identical to the Portal normalization in usesteady-ops
 * `lib/portal/authorityAssertion/gateBasis.ts` (golden vectors pin this).
 */

import { createHash } from "node:crypto";

import { canonicalizeJson } from "./canonical.js";
import type {
  PendingApprovalInput,
  PendingApprovalSystemWill,
} from "../pending-approval/payload.js";
import { buildPendingApprovalPayload } from "../pending-approval/payload.js";

/** Normalize to the explicit five-field shape (nulls materialized, summary trimmed). */
export function normalizeGateBasisSystemWill(sw: PendingApprovalSystemWill): {
  summary: string;
  action_type: string;
  affected_resources: unknown;
  affected_resources_total: unknown;
  affected_resources_truncated: boolean;
} {
  return {
    summary: typeof sw.summary === "string" ? sw.summary.trim() : "",
    action_type: typeof sw.action_type === "string" ? sw.action_type : "",
    affected_resources: sw.affected_resources ?? null,
    affected_resources_total: sw.affected_resources_total ?? null,
    affected_resources_truncated: sw.affected_resources_truncated === true,
  };
}

/** sha256 hex of canonical({ risk, system_will }) over the normalized shape. */
export function pendingGateDecisionBasisFromPayload(input: {
  readonly risk: string;
  readonly system_will: PendingApprovalSystemWill;
}): string {
  return createHash("sha256")
    .update(
      canonicalizeJson({
        risk: input.risk,
        system_will: normalizeGateBasisSystemWill(input.system_will),
      }),
      "utf8",
    )
    .digest("hex");
}

/**
 * Recompute the signed basis for the gate Core currently has open. Uses the
 * same builder as the emit path so the recomputation matches what the Portal
 * stored (and signed) byte-for-byte after normalization.
 */
export function pendingGateDecisionBasisFromInput(input: PendingApprovalInput): string {
  const payload = buildPendingApprovalPayload({ ...input, withdraw: false });
  return pendingGateDecisionBasisFromPayload({
    risk: payload.risk,
    system_will: payload.system_will,
  });
}
