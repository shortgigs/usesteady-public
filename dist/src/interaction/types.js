/**
 * Interaction Contract types.
 *
 * The InteractionContract is a lightweight, immutable record that captures
 * how a subject (user/session) interacts with UseSteady.
 *
 * It is:
 *   - Deterministic: same events produce same transitions
 *   - Pure: no I/O, no side effects in updater
 *   - Not a profile: no personal data, no identity tracking
 *   - Not persistent: in-memory only in this phase
 *
 * The source field tracks confidence:
 *   - "default"        → never adjusted
 *   - "observed"       → adjusted from behavioral signals
 *   - "user_confirmed" → explicitly set by user action
 *
 * ── observedIntentPatterns (advisory session signal) ─────────────────────────
 *
 * Records how many times each intent category was seen in this session.
 * These counts are produced only when the Intent Interpretation Bridge
 * fired AND produced a classification (bridgeFired: true in DebugTrace).
 *
 * CONTRACTS (non-negotiable, must not be violated):
 *
 *   1. observedIntentPatterns is advisory only.
 *      It records what was observed. It adapts nothing automatically.
 *
 *   2. It may only ever affect (in Phase B2, not before):
 *        - guidance ordering
 *        - guidance emphasis
 *        - example ordering
 *
 *   3. It must NEVER affect:
 *        - PRV result
 *        - Safety Gate verdict
 *        - Context Alignment result
 *        - Disambiguation result
 *        - Completion result
 *        - Response mode / intentState
 *        - Interpretation category or confidence
 *
 *   4. No observation event may fire unless bridgeFired === true in the trace.
 *      This ensures counts track meaningful guided interpretations only —
 *      not generic noise, vague inputs, or incomplete completions.
 */
export {};
//# sourceMappingURL=types.js.map