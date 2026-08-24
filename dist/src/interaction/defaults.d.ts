/**
 * Default InteractionContract.
 *
 * Applied to any new subject that has no prior contract.
 * All modes start at balanced/plain_first/syntax_first.
 * All observedIntentPatterns counts start at zero.
 */
import type { InteractionContract, ObservedIntentPatterns } from "./types.js";
export declare const DEFAULT_OBSERVED_INTENT_PATTERNS: Readonly<ObservedIntentPatterns>;
export declare const DEFAULT_CONTRACT: Readonly<InteractionContract>;
export declare function createDefaultContract(subjectId: string, createdAt?: string): InteractionContract;
//# sourceMappingURL=defaults.d.ts.map