/**
 * Phase 9A: Product Shell types.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   These types define the output contract between the session layer and the
 *   I/O layer (CLI main loop, test harness, or any future product surface).
 *
 *   ShellFrame: what the surface should display + ask for next.
 *   The surface renders frames; all authority stays in the session layer.
 *
 * ── What the shell is NOT ─────────────────────────────────────────────────────
 *
 *   NOT authority — it calls session functions; it makes no decisions.
 *   NOT a session — it consumes sessions; it does not manage their state.
 *   NOT a router  — it renders what the session already decided.
 */
export {};
//# sourceMappingURL=types.js.map