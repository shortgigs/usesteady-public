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
export declare function runPRV(input: string, ctx: PRVContext): PRVResult;
//# sourceMappingURL=prv.d.ts.map