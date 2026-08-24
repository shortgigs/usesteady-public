/**
 * Mapper: CompletionResult → CompletionEnvelope.
 *
 * Maps exactly from CompletionResult (src/understand/completion/types.ts).
 * Covers all three completion kinds: complete, incomplete, guided_recovery.
 */
import { createCompletionEnvelope } from "../envelope.js";
export function mapCompletionToEnvelope(result, refs) {
    let payload;
    if (result.kind === "complete") {
        payload = { kind: "complete" };
    }
    else {
        // incomplete or guided_recovery — both carry reason, missing, nextSteps
        payload = {
            kind: result.kind,
            reason: result.reason,
            missing: result.missing,
            nextSteps: result.nextSteps,
        };
    }
    return createCompletionEnvelope(payload, refs);
}
//# sourceMappingURL=map-completion.js.map