/**
 * Intent Interpretation Bridge — interpreter registry.
 *
 * This file owns the ordered list of IntentInterpreter instances.
 * Orchestration logic lives in intent-interpretation.ts.
 *
 * Priority ordering is enforced here at compile time via the sort.
 * Lower priority number = runs first.
 *
 * v1 registry:
 *    5 — workflow  (commit verbs + sequential patterns; wins before config/color/text)
 *   10 — config    (strong config verbs win over color words)
 *   20 — color     (named colors + UI target terms)
 *   30 — text      (text-change verb AND text target, both required)
 */
import type { IntentInterpreter } from "./types.js";
export declare const ALL_INTENT_INTERPRETERS: ReadonlyArray<IntentInterpreter>;
//# sourceMappingURL=registry.d.ts.map