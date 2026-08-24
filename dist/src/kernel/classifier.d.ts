/**
 * Kernel v1 / K4 + K5 + K6 -- replay classifier.
 *
 * -- Scope (PR-K4 design section 3 D1, section 5; K5 v1.0 section 3 D1,
 *          section 5.1; K6 v1.0 section 3 D1) ------------------------------
 *
 *   Pure pre-pass over `WorkflowSpec.tasks`. Decides whether an IR is
 *   replayable end-to-end before any sandbox is created. Drives the per-IR
 *   refusal in `runExecutionReplay` (K4-I10: refusal is per-IR, never
 *   per-task partial execution).
 *
 *   Replayable iff every task is one of:
 *     - operationType: "write_file"   + targetFiles[0] + content
 *     - operationType: "rename"       + targetFiles[0] + newPath
 *     - operationType: "delete_file"  + targetFiles[0]
 *     - operationType: "create_dir"   + targetFiles[0]
 *     - operationType: "append_file"  + targetFiles[0] + content
 *     - operationType: "prepend_file" + targetFiles[0] + content
 *     - structuredReplace: { oldValue, newValue, filePath }
 *     - operationType: "run_command"  + command matching the K5 + K6
 *                                       allow-list (echo <args> / true /
 *                                       false / node -e "<BODY>"; see
 *                                       command-classifier.ts)
 *
 *   Explicitly NOT replayable in K4 + K5 + K6 v1.0:
 *     - bare `{ input: "<NL>" }` (no operationType, no structuredReplace)
 *     - operationType: "run_command" with a command outside the K5 + K6
 *       allow-list (env-dependent or non-deterministic shape; K7+ scope)
 *     - any task with runtime "cursor" | "claude" but no FS op fields set
 *       (would require LLM intake -- out of K4)
 *
 *   Reason discriminant (K5 v1.0 section 3 D5; K6 v1.0 section 10):
 *     - run_command + K6 prefix shape (`node -e "..."`) but BODY out of
 *       K6 scope          -> reason: "non_deterministic_inline_js"
 *     - run_command, any other out-of-scope shape
 *                         -> reason: "non_deterministic_command"
 *     - all other non_replayable refusals
 *                         -> reason: "non_deterministic_task"
 *
 *   The classifier returns the 1-based index of the first non-replayable task
 *   (matches PR-2's `failed_at_step` convention) so the CLI surface and the
 *   verdict surface use the same numbering.
 *
 *   Pure function. No I/O. No imports beyond types.
 */
import type { WorkflowSpec, WorkflowTaskSpec } from "../workflow/types.js";
import type { ClassifierResult } from "./types.js";
export declare function isContainedRelativePath(p: unknown): boolean;
/**
 * True iff this task spec is in the K4 replayable set (design §5.1).
 *
 * Missing companion fields (e.g. `write_file` without `content`) are treated
 * as NON-replayable — the original artifact represents a working run, so a
 * missing field at replay time is itself drift and the IR refuses with
 * `task_index = N` rather than executing and producing a confusing failure.
 */
export declare function isReplayableTaskSpec(spec: WorkflowTaskSpec): boolean;
/**
 * Walk `ir.tasks` once and return either:
 *   - { verdict: "replayable" }                                                    (every task passes)
 *   - { verdict: "non_replayable", task_index: 1-based-int, reason: <discriminant> } (first failing task)
 *
 * Empty `ir.tasks` is replayable (vacuous).
 *
 * The `reason` field was ADDITIVELY added in K5 v1.0 (§3 D5). Pre-K5 callers
 * that read only `verdict` and `task_index` are unaffected.
 */
export declare function classifyForReplay(ir: WorkflowSpec): ClassifierResult;
//# sourceMappingURL=classifier.d.ts.map