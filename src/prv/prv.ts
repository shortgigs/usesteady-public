/**
 * PRV — Pre-Response Validation.
 *
 * runPRV is the mandatory first check before any response is generated.
 * If PRV fails, no further processing occurs.
 *
 * Behavior:
 *   - If input requires prior context AND no context exists → clarify
 *   - Otherwise → ok
 */

import type { PRVResult, PRVContext } from "./types.js";
import { requiresContext, hasRequiredContext } from "./patterns.js";

export function runPRV(input: string, ctx: PRVContext): PRVResult {
  if (requiresContext(input) && !hasRequiredContext(ctx)) {
    return {
      ok: false,
      mode: "clarify",
      reason:
        "This request depends on prior context, but none is available.",
    };
  }
  return { ok: true };
}
