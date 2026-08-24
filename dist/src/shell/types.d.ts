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
export type ShellRuntime = "cursor" | "claude";
/**
 * A ShellFrame is the complete rendering of one session state.
 *
 * The surface prints frame.lines and, if frame.prompt is defined, reads
 * user input. If frame.prompt is absent, the session is terminal — no
 * further input is needed.
 */
export type ShellFrame = {
    /** Lines to print to the terminal. Never empty. */
    readonly lines: readonly string[];
    /**
     * What to ask the user next.
     * Absent when the session phase is terminal (accepted, rejected, exec_error,
     * blocked, not_execute, intake_failed).
     */
    readonly prompt?: ShellPrompt;
};
export type ShellPrompt = {
    /** Yes/no confirmation. Used for "prepared" and "conflict" phases. */
    kind: "confirm";
    question: string;
} | {
    /** Numbered selection. Used for "scope_question" phase. */
    kind: "choose";
    question: string;
    choices: readonly string[];
};
//# sourceMappingURL=types.d.ts.map