/**
 * Deterministic proposal copy per observation code (no LLM).
 */

import type { DiagnosticClass } from "../diagnostics/types.js";

export const PROPOSAL_VERSION = "proposal-v1";

export type ProposalCopy = {
  readonly title: string;
  readonly reason: string;
  readonly expected_effect: string;
  readonly rollback_guidance: string;
  readonly action_class: DiagnosticClass;
};

const COPY_BY_CODE: Readonly<Record<string, ProposalCopy>> = {
  cache_stale: {
    title:              "Refresh entitlement cache (read-only path)",
    reason:
      "Entitlement cache is stale; operator visibility may not reflect current issuer state",
    expected_effect:
      "Cache reflects a fresh read-only issuer fetch after operator runs auth refresh",
    rollback_guidance:
      "No filesystem change from proposal itself; re-run diagnostics if refresh was unintended",
    action_class: "entitlement",
  },
  issuer_unreachable: {
    title:              "Refresh entitlement cache after issuer restore",
    reason:             "Issuer entitlement endpoint is unreachable",
    expected_effect:
      "Diagnostics can re-check issuer reachability after operator restores connectivity",
    rollback_guidance:
      "Verify issuer URL and credentials; no automatic entitlement mutation",
    action_class: "entitlement",
  },
  portal_domain_missing: {
    title:              "Attach portal custom domain",
    reason:
      "Portal URL not configured; operators cannot reach management surface",
    expected_effect:
      "Portal domain check passes after operator attaches DNS",
    rollback_guidance:
      "Remove DNS attachment / revert portal host config",
    action_class: "portal",
  },
  checkout_redirect_mismatch: {
    title:              "Fix checkout redirect URLs",
    reason:             "Checkout success/cancel URLs do not match portal deployment contract",
    expected_effect:
      "Redirect URLs align with configured portal host after operator correction",
    rollback_guidance:
      "Restore previous checkout URL env values from change control",
    action_class: "portal",
  },
  env_suffix_newline_corruption: {
    title:              "Validate environment configuration",
    reason:             "Environment value has trailing newline or whitespace corruption",
    expected_effect:
      "Env probe reports clean suffix after operator fixes values in provider UI",
    rollback_guidance:
      "Re-enter env var without trailing newline; revert provider env if needed",
    action_class: "runtime",
  },
};

export function proposalCopyForCode(code: string): ProposalCopy | undefined {
  return COPY_BY_CODE[code];
}
