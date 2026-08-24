/**
 * Change Interpretation types.
 *
 * ── Scope (v1) ────────────────────────────────────────────────────────────────
 *   1. Tailwind / CSS color changes
 *   2. Text literal changes (button labels, headings, UI copy)
 *   3. Simple config value changes (port, URL, boolean, key-value)
 *
 * ── Role of interpretation ────────────────────────────────────────────────────
 *   Interpretation is ADVISORY.
 *   It does not change the execute/guide/refuse decision — that is locked
 *   before interpretation runs.
 *   It describes WHAT the human will experience from the change, not WHETHER
 *   the change is allowed.
 *
 * ── ParsedChange ──────────────────────────────────────────────────────────────
 *   All interpretation operates on a parsed representation of a structured
 *   change command (replace "X" with "Y" in file, or patch file search="X" replace="Y").
 *   Interpretation returns null for any input that cannot be parsed into this form.
 *
 * ── InterpretationRule ────────────────────────────────────────────────────────
 *   Registry-driven, priority-ordered, deterministic.
 *   Same shape as Safety and Completion rules — ownership, priority, traceability.
 */
/** Type guard: true when pc is a filesystem operation (not a text replacement). */
export function isFsChange(pc) {
    return "operationType" in pc;
}
//# sourceMappingURL=types.js.map