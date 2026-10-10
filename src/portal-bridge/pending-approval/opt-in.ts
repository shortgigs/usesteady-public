/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - opt-in resolution.
 *
 * INV-LA-CFG1: DEFAULT OFF. The live remote-approval bridge is enabled ONLY when
 * the buyer explicitly opts in (a per-run flag analogous to the return bridge's
 * `--report-to-portal`, e.g. `--remote-approval`, wired in a later PR) AND the
 * approvals endpoint URL AND the entitlement bearer token are both present. Any
 * missing piece => disabled, with a structured reason (no throw, no partial send).
 * With opt-in off, Core's approval flow is byte-for-byte unchanged.
 *
 * INV-LA-CFG3: opt-in for remote approval is INDEPENDENT of opt-in for the return
 * bridge - a separate flag and a separate URL. Enabling one never enables the
 * other.
 *
 * INV-LA-CFG2: the bearer is the SAME entitlement-derived token the return bridge
 * uses (USESTEADY_PORTAL_TOKEN), so the constant is imported from the return
 * bridge as the single source of truth - one entitlement token, two bridges.
 *
 * Env vars (resolved on the machine):
 *   - USESTEADY_PORTAL_APPROVALS_URL : Portal base URL for the approvals bridge
 *   - USESTEADY_PORTAL_TOKEN         : entitlement-derived bearer (shared)
 *
 * This module reads env only (mirrors the return bridge's opt-in resolver). It
 * performs no network and no filesystem access.
 */

import { PORTAL_TOKEN_ENV } from "../execution-return/opt-in.js";

export type PortalApprovalsConfig =
  | { readonly enabled: true; readonly url: string; readonly token: string }
  | { readonly enabled: false; readonly reason: PortalApprovalsDisabledReason };

export type PortalApprovalsDisabledReason = "opt_in_off" | "no_url" | "no_token";

export const PORTAL_APPROVALS_URL_ENV = "USESTEADY_PORTAL_APPROVALS_URL";

/**
 * Re-exported for callers/tests: the bearer env var is shared with the execution
 * return bridge (INV-LA-CFG2). Importing rather than redefining keeps a single
 * source of truth for the entitlement token name.
 */
export { PORTAL_TOKEN_ENV };

export function resolvePortalApprovals(input: {
  /** The per-run remote-approval opt-in flag (wired in a later PR). */
  readonly flag: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): PortalApprovalsConfig {
  // Default off (INV-LA-CFG1): no flag => never emit, regardless of env.
  if (!input.flag) return { enabled: false, reason: "opt_in_off" };

  const env = input.env ?? process.env;

  const url = env[PORTAL_APPROVALS_URL_ENV]?.trim();
  if (!url) return { enabled: false, reason: "no_url" };

  const token = env[PORTAL_TOKEN_ENV]?.trim();
  if (!token) return { enabled: false, reason: "no_token" };

  return { enabled: true, url, token };
}
