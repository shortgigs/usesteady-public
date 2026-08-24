/**
 * Mapper: CompletionResult → CompletionEnvelope.
 *
 * Maps exactly from CompletionResult (src/understand/completion/types.ts).
 * Covers all three completion kinds: complete, incomplete, guided_recovery.
 */
import type { CompletionEnvelope, UCPRefs } from "../types.js";
import type { CompletionResult } from "../../understand/completion/types.js";
export declare function mapCompletionToEnvelope(result: CompletionResult, refs?: UCPRefs): CompletionEnvelope;
//# sourceMappingURL=map-completion.d.ts.map