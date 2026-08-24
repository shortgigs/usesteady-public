/**
 * Intent Completion types.
 *
 * ── Result kinds ──────────────────────────────────────────────────────────────
 *
 *   complete        — input is deterministically actionable
 *
 *   incomplete      — intent is unambiguous, a required field is MISSING
 *                     e.g. "commit my changes" → missing commit message
 *                     The user knows what they want; the system knows what's needed.
 *
 *   guided_recovery — intent is vague; system can offer a safe path forward
 *                     e.g. "make button blue" → read file first, then replace
 *                     The user may not know the exact form; the system guides.
 *
 * ── Semantic contract ─────────────────────────────────────────────────────────
 *
 *   incomplete      ≠ guided_recovery
 *
 *   incomplete:       commit my changes → missing message → commit ""
 *   guided_recovery:  make button blue  → vague intent   → read "" then replace "" with "" in ""
 *
 * ── CompletionRule ────────────────────────────────────────────────────────────
 *
 *   Completion is registry-driven. Each rule owns a named, testable pattern.
 *   Rules receive UnderstandContext so context-dependent inputs
 *   ("run again", "same as before") can be resolved when prior session exists.
 *
 *   CONTRACT: Completion is the sole authority on executability.
 *   Disambiguation returning unknown does NOT block completion from returning complete.
 *   Context-dependent executable intent is resolved HERE, not upstream.
 */
export {};
//# sourceMappingURL=types.js.map