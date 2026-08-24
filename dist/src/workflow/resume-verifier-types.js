/**
 * src/workflow/resume-verifier-types.ts
 *
 * P2-min — Resume verification result types.
 *
 * Per-task classification of resume verification outcomes. The
 * coordinator consumes this enum to decide, for each `0..K-1` task,
 * whether to skip silently, prompt the operator for reconfirmation,
 * or stop the resume entirely.
 *
 * Authority discipline:
 *   - These types carry NO approval state. They carry only "what did
 *     the validator say about this task's expected post-state?"
 *   - The operator's decision still happens at runtime. The verifier
 *     classifies; the operator (or `--reexecute-non-idempotent`)
 *     decides for the reconfirmation cases.
 */
export {};
//# sourceMappingURL=resume-verifier-types.js.map