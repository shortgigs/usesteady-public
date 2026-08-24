/**
 * Silent Guidance Mode Selector.
 *
 * Inspects the raw input for shape-level signals and returns the most
 * appropriate guidance template mode.
 *
 * ── Contracts ────────────────────────────────────────────────────────────────
 *
 *   1. Only called when bridgeSilenceReason === "no_interpreter_claimed".
 *   2. Deterministic: same input → same mode, always.
 *   3. Returns a mode — never null. "unknown" is the safe fallback.
 *   4. Does NOT classify intent. Does NOT produce category/confidence.
 *   5. Does NOT guess tools, services, file paths, or values.
 *   6. Does NOT affect mode, signal, intentState, or any decision.
 *   7. Regex match priority: investigation → operation → content_iteration → unknown.
 *      First match wins. This ordering prevents cross-domain false positives.
 *
 * ── Pattern philosophy ────────────────────────────────────────────────────────
 *
 *   Patterns are narrow, not broad.  Better to fall through to "unknown"
 *   (which still shows improved guidance over the old code-patch default)
 *   than to claim a mode incorrectly.
 *
 *   Each pattern targets high-signal, low-ambiguity tokens:
 *   - "debug" is always QA; "deploy" is always ops; "tagline" is always content.
 *   - Ambiguous terms like "improve", "fix", "check" are deliberately excluded
 *     unless combined with a domain-specific qualifier.
 */
import type { SilentGuidanceMode } from "./types.js";
/**
 * Select the appropriate silent guidance template mode for a bridge-silent flow.
 *
 * Priority (first match wins):
 *   1. investigation     — QA / debugging signals
 *   2. operation         — infra / schema / pipeline signals
 *   3. content_iteration — copy / UX / product signals
 *   4. boundary          — out-of-scope multi-step / architectural work
 *   5. unknown           — safe fallback (still better than code-patch default)
 *
 * "code_patch" is never returned here; it applies only when an interpreter
 * already fired (bridgeFired === true), meaning the request is already
 * enriched and needs no silent mode template.
 */
export declare function selectSilentGuidanceMode(input: string): SilentGuidanceMode;
//# sourceMappingURL=selector.d.ts.map