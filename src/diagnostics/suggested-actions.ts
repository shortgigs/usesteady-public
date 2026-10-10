/** Advisory copy only — never executed (INV-DIAG-IMPL-7). */

export const SUGGESTED_ACTION_BY_CODE: Readonly<Record<string, string>> = {
  issuer_unreachable:            "Run: usesteady auth refresh (after issuer is reachable)",
  cache_stale:                   "Run: usesteady auth refresh",
  effective_state_fail_closed:   "Run: usesteady auth refresh; verify USESTEADY_ORG_ID",
  portal_domain_missing:         "Attach portal.usesteady.dev (or configured host)",
  checkout_redirect_mismatch:      "Fix checkout success/cancel URLs in portal env",
  stripe_customer_missing:       "Complete checkout or link customer in portal",
  invoice_projection_unavailable:
    "Verify billing projections in portal dashboard",
  clerk_dev_keys_detected:       "Rotate to production Clerk keys",
  env_suffix_newline_corruption: "Re-enter env var without trailing newline",
  active_org_ambiguous:          "Set USESTEADY_ORG_ID or org_id in ~/.usesteady/config.json",
  migration_missing:             "Apply pending ops database migrations",
  observation_ambiguous:         "Resolve ambiguous configuration and re-run doctor",
};

export function suggestedActionForCode(code: string): string {
  return SUGGESTED_ACTION_BY_CODE[code] ?? "Review configuration and re-run usesteady doctor";
}
