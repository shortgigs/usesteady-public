/**
 * Intent Interpretation Bridge types.
 *
 * ── Two interpretation families ────────────────────────────────────────────────
 *
 *   Change Interpretation (src/understand/interpretation/)
 *     → For executable, structured commands: replace "X" with "Y" in <file>
 *     → Runs when mode === "execute"
 *     → Describes what the change means after the fact
 *
 *   Intent Interpretation Bridge (this module)
 *     → For vague, incomplete requests: "make the button blue"
 *     → Runs when CompletionResult.kind === "guided_recovery"
 *     → Describes what the user appears to be trying to do
 *     → Improves guidance labels — never invents missing values
 *
 * ── Scope contract ─────────────────────────────────────────────────────────────
 *
 *   The bridge MAY:
 *     - Classify broad intent category (visual_color, text_change, config_change, workflow_operation)
 *     - Rewrite guidance labels in human language
 *     - Add rationale to "read first" steps
 *     - Record what signals triggered the classification (basis[])
 *     - Run for both guided_recovery and incomplete completion results (both become guide mode)
 *
 *   The bridge MUST NOT:
 *     - Guess file paths
 *     - Guess current or new values
 *     - Turn guided_recovery or incomplete into complete
 *     - Downgrade safety
 *     - Override mode
 *
 * ── GuidancePayload (home of record) ─────────────────────────────────────────
 *
 *   GuidancePayload lives here because it is enriched by this layer.
 *   intake/types.ts re-imports it from here to avoid circular dependencies.
 *   (understand → intake would be upward; this module is understand-level.)
 */
export {};
//# sourceMappingURL=types.js.map