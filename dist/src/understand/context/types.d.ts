/**
 * Context Alignment types.
 *
 * Context Alignment classifies whether an input makes sense to process given
 * the current session context. It is the first subsystem of the Understand layer.
 *
 * Results:
 *   aligned        — normal processable input
 *   non_literal    — conversational/social input, not a task request
 *   hard_mismatch  — input requires context that does not exist
 */
export type ContextAlignmentResult = {
    readonly kind: "aligned";
} | {
    readonly kind: "non_literal";
} | {
    readonly kind: "hard_mismatch";
    readonly reason: string;
};
//# sourceMappingURL=types.d.ts.map