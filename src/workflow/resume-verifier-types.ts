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

/**
 * How a task's idempotency interacts with resume:
 *
 *   - "checkable"
 *       Op type the validator can fully reason about post-completion:
 *       create, write_file, rename, replace, create_dir, delete, prepend.
 *       The verifier can say `already_done` / `task_state_diverged`
 *       without re-executing.
 *
 *   - "requires_reconfirm"
 *       Op type whose idempotency cannot be cheaply checked:
 *       append (content is appended to existing — can't distinguish
 *       "already appended" from "user wrote the same text by hand"),
 *       run (commands are not bytes on disk — no idempotency signal).
 *       The verifier emits a re-prompt classification; the operator
 *       answers `re-execute` / `skip` / `abort` with `abort` default.
 *
 *   - "interpretive"
 *       Claude-runtime tasks. Output is LLM-generated; the validator
 *       has no opinion. Same surface as `requires_reconfirm` but
 *       distinct so demo/messaging can call it out clearly.
 *
 *   - "skipped"
 *       Task was skipped at original-run time (intake or operator
 *       choice). Stays skipped on resume.
 */
export type IdempotencyClass =
  | "checkable"
  | "requires_reconfirm"
  | "interpretive"
  | "skipped";

/**
 * Closed set of per-task resume-verification verdicts.
 *
 * Discriminants:
 *
 *   - "already_done"
 *       Validator confirms the post-task state is present. Skip
 *       silently. Audit logs "task K verified already-done on resume."
 *
 *   - "task_state_diverged"
 *       Validator says the workspace state is inconsistent with the
 *       task having been completed. STOP the resume; operator must
 *       reconcile manually.
 *
 *   - "requires_reconfirm"
 *       Non-idempotent op (run_command, append_file). The operator
 *       must explicitly answer; default is abort.
 *
 *   - "interpretive_reconfirm"
 *       Claude-runtime op. Same surface as requires_reconfirm but
 *       distinct so messages can say "this was LLM-assisted."
 *
 *   - "previously_skipped"
 *       Task was skipped at original-run time. Stays skipped.
 */
export type TaskVerificationVerdict =
  | "already_done"
  | "task_state_diverged"
  | "requires_reconfirm"
  | "interpretive_reconfirm"
  | "previously_skipped";

export type TaskVerificationFinding = {
  readonly task_index:         number;
  readonly task_label:         string;
  readonly op_type:            string;
  readonly idempotency_class:  IdempotencyClass;
  readonly verdict:            TaskVerificationVerdict;
  /**
   * Human-readable detail for the operator. For `already_done` this is
   * typically a one-liner ("file exists with expected content"). For
   * `task_state_diverged` it includes the validator's reason.
   */
  readonly detail:             string;
};

/**
 * The aggregated outcome of running verification across the
 * `[0, completed_task_count)` range. Drives the coordinator's
 * decision about whether to start the resumed run.
 */
export type ResumeVerificationReport = {
  readonly findings:        readonly TaskVerificationFinding[];
  readonly already_done:    number;
  readonly diverged:        number;
  readonly reconfirm:       number;
  readonly previously_skipped: number;
  /**
   * Aggregate gate. Drives the dispatcher:
   *   - "clean"     → all verified or previously_skipped; resume proceeds.
   *   - "needs_reconfirm" → some tasks require operator answers; resume
   *                  enters a re-prompt phase.
   *   - "diverged"  → at least one task diverged; resume MUST refuse.
   */
  readonly aggregate:       "clean" | "needs_reconfirm" | "diverged";
};
