/**
 * Phase 9A + 9E + 10C: Product Shell ? CLI main loop.
 *
 * ?? Purpose ???????????????????????????????????????????????????????????????????
 *
 *   A thin readline loop that drives CursorProductSession, ClaudeProductSession,
 *   or a WorkflowRun end-to-end from the terminal.
 *
 *   This is the only file in the shell layer with I/O. Everything else is pure.
 *
 * ?? Usage ?????????????????????????????????????????????????????????????????????
 *
   *   npx tsx src/shell/cli/main.ts cursor [workspace-root]
 *   npx tsx src/shell/cli/main.ts claude
 *   npx tsx src/shell/cli/main.ts workflow [spec.json] [workspace-root]
 *   npx tsx src/shell/cli/main.ts history [store-dir]
 *
 *   workflow spec.json format:
 *     {
 *       "name": "My workflow",
 *       "tasks": [
 *         { "input": "replace X with Y in src/Button.tsx", "label": "Optional label" },
 *         { "input": "...", "runtime": "claude" }
 *       ],
 *       "defaultRuntime": "cursor",
 *       "maxRetries": 2
 *     }
 *   If no spec.json is provided, the CLI prompts H to build a spec interactively.
 *
 *   Environment variables (AI runtime — deterministic by default):
 *     USESTEADY_USE_LLM=true    - opt-in to an optional LLM provider (canonical flag)
 *     USESTEADY_USE_GROK=true   - back-compat alias for USESTEADY_USE_LLM (xAI/Grok)
 *     USESTEADY_USE_OPENAI_COMPAT=true - legacy alias (OpenAI-compatible real-call enablement)
 *     XAI_API_KEY               - required for real xAI/Grok calls
 *     XAI_BASE_URL              - optional; defaults to https://api.x.ai/v1
 *     GROK_MODEL                - optional; defaults to grok-3
 *     USESTEADY_USE_CLAUDE=true - opt-in to Anthropic/Claude
 *     ANTHROPIC_API_KEY         - required for real Claude calls
 *   Providers are peers — none is designated primary. When no AI flag is set,
 *   execution is deterministic (stub) and fully functional.
 *
 * ?? Loop contract ?????????????????????????????????????????????????????????????
 *
 *   Single-session (cursor / claude):
 *     1. submit() ? run intake + prepare
 *     2. render()  ? print phase header + display + prompt (if any)
 *     3. read answer ? y/n for confirm, number for choose
 *     4. advance() ? call appropriate session function(s)
 *     5. render() again ? print result
 *     6. start new session
 *
 *   Workflow (Phase 9E + 11D, WS6 generic loop):
 *     1. createWorkflowRun() ? "reviewing" ? H reviews the full task list first
 *     2. renderWorkflowFrame() ? print phase header + task detail + prompt
 *     3. dispatch on frame.prompt?.kind ? confirm or choose, no runtime branching
 *     4. advanceWorkflowOnConfirm (reviewing ? startWorkflow / cancelWorkflow)
 *        advanceWorkflowOnConfirm / advanceWorkflowOnChoice (task execution)
 *     5. loop until isWorkflowTerminal()
 *
 *   "exit" at the input prompt quits the loop.
 *
 * ?? What this loop does NOT do ????????????????????????????????????????????????
 *
 *   NOT evaluate policy  ? policy comes from defaults.ts / DEFAULT_WORKFLOW_POLICIES
 *   NOT decide approval  ? reads from user, passes to session / coordinator
 *   NOT manage sessions  ? each command = new session; each workflow run = new run
 */
export { loadWorkflowSpecFromFile, WorkflowSpecLoadError, } from "./workflow-spec-loader.js";
/**
 * The Phase 9E workflow run loop.
 *
 * Implements the WS6 generic loop exactly:
 *   - dispatches on frame.prompt?.kind only
 *   - no runtime-specific branching inside the loop body
 *   - calls only frozen shell advance functions and the coordinator
 *
 * Runs once per workflow spec. After terminal state, prompts H to run another.
 */
/**
 * runWorkflowLoop — executes a workflow spec interactively or non-interactively.
 *
 * Mode separation contract:
 *   autoYes = false  →  Interactive: readline prompts at every decision point.
 *   autoYes = true   →  Execution:   zero prompts, deterministic, CI-safe.
 *                        All confirms auto-approved; loop runs exactly once.
 *
 * Stabilization P0 / PR-3: executionPolicy is an orthogonal axis to autoYes.
 *   "interactive"      → task_failed offers stop/skip/retry (unchanged).
 *   "batch_fail_fast"  → task_failed forces stop; silent-skip outcomes
 *                        (skipped_by_intake / skipped / rejected) promote
 *                        to hard failure. Set only for --batch <file> and
 *                        --json '<array>'. See execution-policy.ts.
 */
/**
 * P2-min — Resume options for `runWorkflowLoop`.
 *
 * Both fields are operator-supplied at invocation time. Neither carries
 * approval authority: even with `--reexecute-non-idempotent` set, each
 * task still goes through the existing approval flow.
 *
 *   - `resumeFromPath`: absolute or process-cwd-relative path to a v1
 *     resume token. When set, the workflow loop:
 *       1. validates the token against the loaded spec + workspace
 *       2. runs per-task verification across `[0, completed_task_count)`
 *       3. on `aggregate === "clean"`, advances past the verified tasks
 *       4. on `"needs_reconfirm"`, refuses unless
 *          `reexecuteNonIdempotent === true`
 *       5. on `"diverged"`, always refuses (exit 2)
 *
 *   - `reexecuteNonIdempotent`: opt-in for CI/non-interactive resume of
 *     workflows containing `append_file`, `prepend_file`, `replace`,
 *     `run_command`, or `claude`-runtime tasks. The default is to
 *     refuse, so a fresh user invocation cannot accidentally
 *     re-execute a non-idempotent op without seeing the operator
 *     confirm it.
 */
export type RunWorkflowResumeOptions = {
    readonly resumeFromPath?: string;
    readonly reexecuteNonIdempotent?: boolean;
};
export declare const _runComplete: Promise<void>;
//# sourceMappingURL=main.d.ts.map