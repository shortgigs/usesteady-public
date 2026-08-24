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
import * as fs from "node:fs";
import { join } from "node:path";
import { runOnboarding } from "./onboarding.js";
import { captureActivation } from "../../friction/activation.js";
import { capture, shutdown as phShutdown } from "../../friction/posthog.js";
import { detectClaudeKey, runSetupPrompt } from "./claude-setup.js";
import { SessionController } from "../../session/controller.js";
import { hydrateEnvFromConfig } from "./config-hydration.js";
import { buildRequiredProviderIds, getMissingProviders, isProviderLive, } from "../../utils/credentials.js";
import { isTerminal as isCursorTerminal } from "../../product/cursor-product-session.js";
import { isClaudeTerminal } from "../../product/claude-product-session.js";
import { createSession, submit, } from "../../product/cursor-product-session.js";
import { createClaudeSession, submitClaude, } from "../../product/claude-product-session.js";
import { CursorInProcessAdapter } from "../../cursor/adapters/inprocess-adapter.js";
import { ClaudeStubAdapter } from "../../claude/adapters/stub-adapter.js";
import { ClaudeApiAdapter } from "../../claude/adapters/api-adapter.js";
import { OpenAiCompatibleAgentAdapter } from "../../claude/adapters/openai-compatible-adapter.js";
import { renderClaudeFrame, renderWorkflowFrame, renderHistoryFrame, advanceCursorOnConfirm, advanceCursorOnChoice, advanceClaudeOnConfirm, advanceClaudeOnChoice, advanceWorkflowOnConfirm, advanceWorkflowOnChoice, DEFAULT_CURSOR_POLICY, DEFAULT_CLAUDE_OCD_POLICY, DEFAULT_CLAUDE_TOOL_POLICY, DEFAULT_WORKFLOW_POLICIES, resolveStoreDir, } from "../index.js";
import { renderReplCursorFrame } from "../repl-guide-presenter.js";
import { makeFsBoundaryObserver, makeJsonlBoundarySink } from "../../execution/fs-boundary-observer.js";
import { makeBoundaryJsonlSink, makeClaudeBoundaryObserver, makeCursorBoundaryObserver } from "../../execution/boundary-observer.js";
import { createWorkflowRun, advanceWorkflow, applyFailureAction, isWorkflowTerminal, persistWorkflowRun, } from "../../workflow/index.js";
// P2-min: resume-token persistence. Token is written after each task's
// terminal outcome ("accepted" or "skipped"). Authority discipline:
// the token carries no approval state and is operator-visible at
// `<workspace>/.usesteady/resume-tokens/<runId>.json`.
import { buildResumeToken } from "../../workflow/resume-token-builder.js";
import { writeResumeToken } from "../../workflow/resume-token-io.js";
import { validateTokenForResume } from "../../workflow/resume-token-validator.js";
import { verifyResumePoint } from "../../workflow/resume-verifier.js";
import { loadTeamPolicyPack, renderTeamPolicyRunBannerLines, } from "../../workflow/team-policy-pack.js";
import { mapWorkflowExecutionResultToEnvelope } from "../../ucp/mappers/map-workflow-execution-result.js";
import { persistEnvelope } from "../../ucp/persistence/write.js";
import { getEnvelopeById } from "../../ucp/persistence/query.js";
import { reportRunToPortal, unavailableDecisionSummary, deliveryReportSummaryFromOutcomes, outcomeVerificationFromTasks, primaryTaskInput, } from "../../portal-bridge/execution-return/index.js";
import { captureCertificationChainSnapshot, resolveReportUcpRootId, } from "../../portal-bridge/execution-return/resolve-report-ucp-root.js";
import { postCoreUnderstandWorkflow, USESTEADY_CORE_URL_ENV, } from "../../portal-bridge/post-core-understand-workflow.js";
import { resolvePortalApprovals, resolveRemoteApprovalDecision, } from "../../portal-bridge/pending-approval/index.js";
import { createBridgeApprovalProvenanceState, recordBridgeApprovalDecision, resolveExecutionReturnApprovalProvenance, } from "../../portal-bridge/approval-provenance/index.js";
import { appendPortalAuthorityEvidence } from "../../portal-bridge/authority-assertion/index.js";
import { buildKernelArtifact, buildKernelResultFromRun } from "../../kernel/artifact.js";
import { persistKernelArtifact } from "../../kernel/persist.js";
import { finalizeErrorCode } from "../../kernel/error-codes.js";
import { getWorkflowHistories, getWorkflowAuditRecord, } from "../../history/index.js";
import { setTuiState } from "../tui/state-bridge.js";
import { classifyWorkflowTerminalOutcome, parseConfirmInput, } from "./workflow-terminal.js";
import { buildExecutionSummary, renderExecutionSummaryLines, } from "./execution-summary.js";
import { resolveExecutionPolicy, } from "./execution-policy.js";
// Stabilization P0 / PR-5 (D2 Fix A) — pure spec-path resolver. Resolves
// a relative spec against workspaceRoot when both positionals are
// present; otherwise preserves cwd-relative behavior.
import { resolveWorkflowSpecPath } from "./resolve-spec-path.js";
// ─── Session controller + ask helper ───────────────────────────────────────
//
// M5 §13 commit 4 — audit entry 1 migration.
//
// Previously main.ts created its own `readline.Interface` via `createRL()`
// and passed it around as `rl: readline.Interface`. That was the top-level
// REPL reader and the `runCursorLoop / runClaudeLoop / runWorkflowLoop /
// runHistoryLoop` helpers all received it directly.
//
// After this commit the top-level owner is a `SessionController`, which
// internally owns the single `readline.Interface` against `process.stdin`.
// The loop helpers accept the controller instead of the raw interface;
// `ask(rl, q)` is rewritten to delegate to `rl.requestInput({ until:
// "line" })`. The function parameter name `rl` is preserved deliberately
// so this commit's diff stays type-narrow: every signature changes from
// `rl: readline.Interface` to `rl: SessionController`, and the 17 call
// sites that do `await ask(rl, "...")` inside the loops compile unchanged.
//
// After commit 6, `runSetupPrompt` (commit 5), `runOnboarding`, and
// `runSetupSubcommand` all accept the SessionController directly; after
// commit 7 friction-report does as well. Commit 8 removes the temporary
// `ensureRl()` bridge from SessionController itself (no callers remain)
// and enables the CI grep guard in `release:gate` that forbids any
// reintroduction of createInterface / process.stdin readers outside
// src/session/controller.ts. `import * as readline` is no longer used
// in this file.
function createController(autoYes) {
    return new SessionController({
        mode: "interactive",
        autoYes: autoYes,
        // stdin/stdout/terminal default to process.* + stdin.isTTY check
        // (matches the old createRL semantics byte-for-byte).
    });
}
function ask(rl, question) {
    return rl.requestInput({
        purpose: "nl_input",
        prompt: question,
        until: "line",
    });
}
// ??? Output helpers ???????????????????????????????????????????????????????????
function sanitizeForConsole(line) {
    let out = line;
    const replacements = [
        ["â†’", "->"],
        ["â€™", "'"],
        ["â€œ", "\""],
        ["â€\u009d", "\""],
        ["â€”", "-"],
        ["â€“", "-"],
        ["→", "->"],
        ["—", "-"],
        ["–", "-"],
        ["✓", "ok"],
        ["✔", "ok"],
        ["✅", "ok"],
        ["❌", "x"],
        ["✖", "x"],
        ["⚠", "warn"],
        ["ℹ", "i"],
        ["•", "-"],
        ["·", "-"],
        ["─", "-"],
    ];
    for (const [from, to] of replacements) {
        out = out.split(from).join(to);
    }
    // Final guard: keep shell output strictly ASCII for terminal compatibility.
    return out.replace(/[^\x00-\x7F]/g, "");
}
function print(lines) {
    if (process.env["USESTEADY_QUIET"] === "true")
        return;
    for (const line of lines) {
        process.stdout.write(sanitizeForConsole(line) + "\n");
    }
}
function printBanner(runtime, autoYes = false) {
    if (runtime === "onboarding")
        return; // onboarding prints its own header
    // PR-K3: suppress the interactive workflow/history banner under --yes.
    // The banner's help line — "Provide a spec.json or build a spec
    // interactively. Type 'exit' to quit." — promises a fully interactive
    // path that --yes will never take, so in non-interactive mode it just
    // adds noise before the real output (or before a pre-loop failure
    // like missing-spec). Cursor / claude banners are retained: their
    // "Type your request:" copy is the intended REPL entry prompt and
    // those loops are never entered under --yes from the `usesteady`
    // entrypoint.
    if ((runtime === "workflow" || runtime === "history") && autoYes)
        return;
    if (runtime === "cursor" || runtime === "claude") {
        print([
            "",
            "  UseSteady",
            "",
            "  AI can propose changes.",
            "  You approve before they run.",
            "",
            "  Type your request:",
        ]);
        return;
    }
    // Workflow and history modes keep a brief technical header.
    // PR-K3: the source literal used a non-ASCII separator that
    // `sanitizeForConsole` strips to a stray "?" at render time, producing
    // `UseSteady ? Workflow`. Use a plain ASCII hyphen with surrounding
    // spaces — renders cleanly in every shell and conveys the same
    // "product / mode" relationship.
    const label = runtime === "workflow" ? "Workflow" : "History";
    const helpLine = runtime === "workflow"
        ? "  Provide a spec.json or build a spec interactively. Type 'exit' to quit."
        : "  Browse workflow audit records, or type 'exit' to quit.";
    print([
        "",
        `  UseSteady - ${label}`,
        helpLine,
        "",
    ]);
}
// ??? Answer parsing ???????????????????????????????????????????????????????????
function isYes(answer) {
    const a = answer.trim().toLowerCase();
    return a === "y" || a === "yes";
}
function parseChoice(answer) {
    return parseInt(answer.trim(), 10);
}
// ??? Cursor run loop ??????????????????????????????????????????????????????????
async function runCursorLoop(rl, workspaceRoot, firstInput, onboardingSessionId) {
    const storeDir = resolveStoreDir();
    // Session-seam boundary observation (P2 completion, E7): the legacy REPL
    // loop must not hold a bare adapter — observe the receive() seam.
    const plugin = makeCursorBoundaryObserver(new CursorInProcessAdapter(workspaceRoot), makeBoundaryJsonlSink(join(storeDir, "boundary-observations.jsonl")));
    let pendingInput = firstInput;
    let secondPromptFired = false;
    while (true) {
        let input;
        if (pendingInput !== undefined) {
            input = pendingInput;
            pendingInput = undefined;
            process.stdout.write(`\n  > ${input}\n`);
        }
        else {
            input = await ask(rl, "\n> ");
        }
        if (input.trim().toLowerCase() === "exit")
            break;
        // Metric 3: second_prompt_entered ? first real request after onboarding
        if (onboardingSessionId && !secondPromptFired && input.trim()) {
            secondPromptFired = true;
            captureActivation("second_prompt_entered", onboardingSessionId);
        }
        let session = createSession();
        session = submit(session, input, DEFAULT_CURSOR_POLICY);
        while (!isCursorTerminal(session)) {
            const frame = renderReplCursorFrame(session);
            print(frame.lines);
            if (!frame.prompt)
                break;
            session = await handleCursorPrompt(rl, session, frame.prompt, plugin, storeDir);
        }
        // Print terminal state.
        print(renderReplCursorFrame(session).lines);
    }
}
async function handleCursorPrompt(rl, session, prompt, plugin, storeDir) {
    if (prompt.kind === "confirm") {
        const answer = await ask(rl, `  ${prompt.question} `);
        return advanceCursorOnConfirm(session, isYes(answer), plugin, storeDir);
    }
    if (prompt.kind === "choose") {
        print([`  ${prompt.question}`]);
        const answer = await ask(rl, "  Enter number: ");
        const n = parseChoice(answer);
        if (isNaN(n))
            return session;
        return advanceCursorOnChoice(session, n, plugin, storeDir);
    }
    return session;
}
// ??? Claude run loop ??????????????????????????????????????????????????????????
function buildClaudePlugin() {
    // Deterministic by default. AI execution is opt-in and never changes the
    // approval gate — the selected plugin only receives already-approved
    // deliveries.
    //
    // An optional LLM provider can be enabled via USESTEADY_USE_LLM (canonical),
    // or the back-compat alias USESTEADY_USE_GROK. xAI's API is OpenAI-compatible,
    // so it routes through the OpenAI-compatible adapter pointed at
    // https://api.x.ai/v1 by default. Providers are peers — none is designated
    // primary. (Provider-selection precedence is intentionally unchanged here;
    // making it config-driven is a separately-scoped task.)
    if (process.env["USESTEADY_USE_LLM"] === "true" ||
        process.env["USESTEADY_USE_GROK"] === "true") {
        return new OpenAiCompatibleAgentAdapter({
            apiKey: process.env["XAI_API_KEY"] ?? "",
            baseURL: process.env["XAI_BASE_URL"] ?? "https://api.x.ai/v1",
            model: process.env["GROK_MODEL"] ?? "grok-3",
            bypass: ClaudeStubAdapter.accepted("cli-demo-session"),
        });
    }
    // Anthropic / Claude is also available as an opt-in.
    if (process.env["USESTEADY_USE_CLAUDE"] === "true") {
        const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
        return new ClaudeApiAdapter({ apiKey });
    }
    // No AI opt-in: deterministic stub for demo/development without any API key.
    return ClaudeStubAdapter.accepted("cli-demo-session");
}
async function runClaudeLoop(rl) {
    // #150: single-runtime pre-flight. The claude loop always requires the
    // anthropic provider. Same live/demo split as the workflow loop; same
    // helpers; same definition of live mode. Keep the two paths aligned.
    const required = buildRequiredProviderIds(["claude"]);
    const missing = getMissingProviders(required);
    const missingLive = missing.filter(p => isProviderLive(p));
    if (missingLive.length > 0) {
        print([
            "",
            `  ✗ Cannot start — missing API key for ${missingLive.map(p => p.displayName).join(", ")}.`,
            "",
        ]);
        for (const p of missingLive) {
            print([
                `    • Set ${p.envKey}${p.setupUrl ? ` (keys: ${p.setupUrl})` : ""}`,
            ]);
        }
        print([""]);
        process.exit(1);
    }
    const storeDir = resolveStoreDir();
    // Session-seam boundary observation (P2 completion, E7): observe the
    // receive() seam in the legacy REPL loop too — no bare plugin.
    const plugin = makeClaudeBoundaryObserver(buildClaudePlugin(), makeBoundaryJsonlSink(join(storeDir, "boundary-observations.jsonl")));
    const missingDemo = missing.filter(p => !isProviderLive(p));
    if (missingDemo.length > 0) {
        print([
            `  ℹ Using demo mode (no API key configured for ${missingDemo.map(p => p.displayName).join(", ")}). Set ${missingDemo.map(p => {
                const toggle = p.liveModeEnv
                    ? `${p.liveModeEnv}=${p.liveModeEnvExpectedValue ?? "true"}`
                    : null;
                return `${p.envKey}=<key>${toggle ? ` and ${toggle}` : ""}`;
            }).join("; ")} for live execution.`,
        ]);
    }
    while (true) {
        const input = await ask(rl, "\n> ");
        if (input.trim().toLowerCase() === "exit")
            break;
        let session = createClaudeSession();
        session = submitClaude(session, input, DEFAULT_CLAUDE_OCD_POLICY, DEFAULT_CLAUDE_TOOL_POLICY);
        while (!isClaudeTerminal(session)) {
            const frame = renderClaudeFrame(session);
            print(frame.lines);
            if (!frame.prompt)
                break;
            session = await handleClaudePrompt(rl, session, frame.prompt, plugin, storeDir);
        }
        print(renderClaudeFrame(session).lines);
    }
}
async function handleClaudePrompt(rl, session, prompt, plugin, storeDir) {
    if (prompt.kind === "confirm") {
        const answer = await ask(rl, `  ${prompt.question} `);
        return advanceClaudeOnConfirm(session, isYes(answer), plugin, storeDir);
    }
    if (prompt.kind === "choose") {
        print([`  ${prompt.question}`]);
        const answer = await ask(rl, "  Enter number: ");
        const n = parseChoice(answer);
        if (isNaN(n))
            return session;
        return advanceClaudeOnChoice(session, n, plugin, storeDir);
    }
    return session;
}
// ─── Consensus audit helpers (read-only, no execution side effects) ──────────
/**
 * Count the current number of lines in the consensus audit JSONL file.
 * Returns 0 if the file does not exist (multi-LLM not active).
 * Used to snapshot the position before a workflow run starts.
 */
function countAuditLines(auditFile) {
    try {
        const content = fs.readFileSync(auditFile, "utf8");
        return content.split("\n").filter(Boolean).length;
    }
    catch {
        return 0;
    }
}
/**
 * Read all lines appended to the audit file since the given offset (line count).
 * Parses each line as JSON, stripping the optional "[consensus-audit] " prefix.
 * Silently skips malformed lines.
 */
function readAuditLinesSince(auditFile, offsetLines) {
    try {
        const content = fs.readFileSync(auditFile, "utf8");
        const lines = content.split("\n").filter(Boolean);
        const newLines = lines.slice(offsetLines);
        const results = [];
        for (const line of newLines) {
            try {
                const stripped = line.startsWith("[consensus-audit] ")
                    ? line.slice("[consensus-audit] ".length)
                    : line;
                const parsed = JSON.parse(stripped);
                if (parsed && typeof parsed.quorumState === "string") {
                    results.push(parsed);
                }
            }
            catch {
                // Skip malformed lines — best-effort only.
            }
        }
        return results;
    }
    catch {
        return [];
    }
}
/**
 * Derive a human-readable reason for a no_quorum result based on the
 * rationaleCategory fields from the round entries.
 *
 * Uses ConsensusRoundEntry.rationaleCategory (existing field, no new types):
 *   "scope"                 → scope concern
 *   "execution_feasibility" → capability disagreement
 *   mixed / other           → generic disagreement message
 */
function noQuorumReason(rounds) {
    const categories = rounds.map(r => r.rationaleCategory ?? "").filter(Boolean);
    const hasScope = categories.some(c => c === "scope");
    const hasFeasib = categories.some(c => c === "execution_feasibility");
    if (hasScope && !hasFeasib) {
        return "models disagreed on scope -- one or more models raised scope concerns";
    }
    if (hasFeasib && !hasScope) {
        return "models disagreed on execution capability";
    }
    // Both or neither — use semantic framing (both accepted but hash differed)
    const allAccepted = rounds.every(r => r.disposition === "accepted");
    if (allAccepted) {
        return "models accepted different structural interpretations of the task";
    }
    return "models did not agree on execution";
}
/**
 * Map a plugin's raw disposition string to a TUI-level label.
 *
 * The four-value set mirrors TuiConsensusEntry.disposition.
 * "Unknown" is the safe fallback — never omitted.
 */
function mapDisposition(raw) {
    switch (raw) {
        case "accepted": return "Accepted";
        case "refused_scope": return "Scope concern";
        case "refused_error": return "Execution error";
        default: return "Unknown";
    }
}
/**
 * Map a raw plugin name to a human-friendly label for the ConsensusPanel.
 *
 * "claude" → "Claude"
 * "openai-compatible" → "Secondary"
 * Other primary → capitalize; other secondary → "Secondary"
 */
function mapPluginLabel(pluginName, isPrimary) {
    if (pluginName === "claude")
        return "Claude";
    if (pluginName === "openai-compatible")
        return "Secondary";
    if (isPrimary)
        return pluginName.charAt(0).toUpperCase() + pluginName.slice(1);
    return "Secondary";
}
/**
 * Derive TuiConsensusEntry[] from audit entries appended since the last offset.
 *
 * Strategy: take the last audit entry that is a multi-LLM run (policyMode === "multi").
 * From its rounds, deduplicate by pluginName taking the final round per plugin.
 * Returns an empty array when multi-LLM was not active or no entries found.
 */
function deriveConsensusEntries(auditFile, offsetBefore) {
    const entries = readAuditLinesSince(auditFile, offsetBefore);
    // Find the last multi-LLM entry (most recent task result)
    const multiEntry = [...entries].reverse().find(e => e.policyMode === "multi");
    if (!multiEntry)
        return [];
    // Deduplicate rounds by pluginName — take the last round per plugin
    const perPlugin = new Map();
    for (const round of multiEntry.rounds) {
        if (round.pluginName) {
            perPlugin.set(round.pluginName, round);
        }
    }
    const result = [];
    for (const [pluginName, round] of perPlugin) {
        const isPrimary = pluginName === multiEntry.primaryPlugin;
        result.push({
            label: mapPluginLabel(pluginName, isPrimary),
            disposition: mapDisposition(round.disposition),
        });
    }
    // Sort: primary first
    result.sort((a, _b) => a.label === "Claude" ? -1 : 1);
    return result;
}
/**
 * Print a human-readable consensus explanation block after a workflow run.
 * Reads only records appended since auditOffsetBefore (file-offset correlation).
 * Prints nothing if multi-LLM was not active for this run.
 */
function printConsensusExplanation(auditFile, auditOffsetBefore) {
    const entries = readAuditLinesSince(auditFile, auditOffsetBefore);
    if (entries.length === 0)
        return;
    // Only show if this was a multi-LLM run.
    const isMulti = entries.some(e => e.policyMode === "multi");
    if (!isMulti)
        return;
    print([""]);
    for (const entry of entries) {
        const roundCount = entry.rounds?.length ?? 0;
        const rounds = `(${roundCount} round${roundCount === 1 ? "" : "s"})`;
        switch (entry.quorumState) {
            case "unanimous":
                print([`  ✅ Multi-model check: Passed ${rounds}`]);
                break;
            case "no_quorum": {
                const reason = noQuorumReason(entry.rounds ?? []);
                print([
                    `  ❌ Multi-model check: Blocked -- ${reason}.`,
                    `     Change was NOT applied.`,
                ]);
                break;
            }
            case "scope_blocked":
                print([
                    `  ⚠  Multi-model check: Step was scope-blocked before consensus could run.`,
                ]);
                break;
            case "primary_only":
                print([`  ℹ  Multi-model check: Ran on primary model only ${rounds}`]);
                break;
            case "timeout":
                print([
                    `  ⚠  Multi-model check: Timed out -- consensus could not be reached.`,
                    `     Change was NOT applied.`,
                ]);
                break;
            default:
                // Unknown state — print nothing rather than confuse the user.
                break;
        }
    }
    print([""]);
}
function persistWorkflowTerminalOutcome(record) {
    const p = process.env["USESTEADY_WORKFLOW_OUTCOME_PATH"];
    if (!p)
        return;
    const runToken = process.env["USESTEADY_WORKFLOW_OUTCOME_TOKEN"]?.trim() || undefined;
    try {
        fs.writeFileSync(p, JSON.stringify({
            ...record,
            ...(runToken ? { runToken } : {}),
        }), "utf8");
    }
    catch {
        // Non-fatal: outcome persistence is advisory for caller mapping.
    }
}
// ─── Workflow spec loading (extracted P7-min) ────────────────────────────
//
// The loader, its typed error class, the auto-wrap helpers, and the
// RUN_SPEC_ACCEPTED_SHAPES_MESSAGE constant were extracted to
// ./workflow-spec-loader.ts (P7-min) so the P7-min `workflow inspect`
// command surface can import the loader without triggering this file's
// top-level main() invocation. Behavior is preserved verbatim. Both
// symbols are re-exported here so existing importers of ./main.js
// continue to resolve them unchanged.
import { loadWorkflowSpecFromFile, WorkflowSpecLoadError, } from "./workflow-spec-loader.js";
export { loadWorkflowSpecFromFile, WorkflowSpecLoadError, } from "./workflow-spec-loader.js";
/**
 * Interactively build a WorkflowSpec by prompting H for each task.
 *
 * Called when no spec file is provided.
 */
async function buildWorkflowSpecInteractively(rl) {
    // Interactive exit contract: "exit" at any interactive prompt must leave the
    // session cleanly. Pre-fix, typing "exit" at the workflow-name prompt was
    // silently accepted as the workflow name ("Workflow name: exit"). Caller
    // must treat null return as a user-initiated stop.
    const isExit = (s) => {
        const t = s.trim().toLowerCase();
        return t === "exit" || t === "quit" || t === ":q" || t === "q";
    };
    const nameRaw = (await ask(rl, "  Workflow name (or 'exit' to leave): ")).trim();
    if (isExit(nameRaw))
        return null;
    const name = nameRaw || "Untitled Workflow";
    print(["  Enter task inputs one by one. Type 'done' when finished, or 'exit' to leave."]);
    const tasks = [];
    let taskNum = 1;
    while (true) {
        const input = (await ask(rl, `\n  Task ${taskNum} input (or 'done' / 'exit'): `)).trim();
        if (isExit(input))
            return null;
        if (!input || input.toLowerCase() === "done")
            break;
        const labelRaw = (await ask(rl, `  Task ${taskNum} label (Enter to skip): `)).trim();
        const runtimeRaw = (await ask(rl, `  Task ${taskNum} runtime [cursor/claude, Enter for cursor]: `)).trim().toLowerCase();
        tasks.push({
            input,
            ...(labelRaw ? { label: labelRaw } : {}),
            ...(runtimeRaw === "claude" ? { runtime: "claude" } : {}),
        });
        taskNum++;
    }
    if (tasks.length === 0) {
        tasks.push({ input: "demo: replace bg-blue-500 with bg-red-500 in src/Button.tsx", label: "Demo task" });
        print(["  No tasks entered ? added one demo task."]);
    }
    return { name, tasks };
}
async function runWorkflowLoop(rl, specPath, workspaceRoot, autoYes = false, executionPolicy = "interactive", resumeOptions = {}, reportToPortal = false, pendingApprovalBridge = false) {
    // Build plugins — the coordinator picks the right one by task runtime (W8).
    // The same CursorInProcessAdapter instance is used for both cursor-runtime
    // tasks (str_replace, read) and direct fs operations (rename, delete, create).
    const cursorAdapter = new CursorInProcessAdapter(workspaceRoot);
    const storeDir = resolveStoreDir();
    // Session-seam boundary observation (P2 completion): observe-only records
    // of the request AS RECEIVED at each plugin's receive() seam. See
    // src/execution/boundary-observer.ts.
    const sessionSink = makeBoundaryJsonlSink(join(storeDir, "boundary-observations.jsonl"));
    const plugins = {
        cursor: makeCursorBoundaryObserver(cursorAdapter, sessionSink),
        // Boundary observation at the adapter seam: observe-only, same reference
        // forwarded, result verbatim. See src/execution/fs-boundary-observer.ts.
        fs: makeFsBoundaryObserver(cursorAdapter, makeJsonlBoundarySink(join(storeDir, "fs-boundary-observations.jsonl"))),
        claude: makeClaudeBoundaryObserver(buildClaudePlugin(), sessionSink),
    };
    // PENDING_APPROVAL_BRIDGE_LANE_A_V1: resolve opt-in ONCE. Default off. Enabled
    // only when the per-run flag is set AND USESTEADY_PORTAL_APPROVALS_URL +
    // USESTEADY_PORTAL_TOKEN are both present. When disabled, the confirm branch
    // below never touches the bridge and the local approval flow is unchanged.
    const approvalsConfig = resolvePortalApprovals({ flag: pendingApprovalBridge });
    // TUI execution monitor — activated with USESTEADY_TUI=true.
    // Renders to stderr; does not affect stdout or execution logic.
    const tuiEnabled = process.env["USESTEADY_TUI"] === "true";
    if (tuiEnabled) {
        const { startTui } = await import("../tui/index.js");
        startTui();
    }
    let lastRecord = {
        outcome: "failed_explicit",
        exitCode: 1,
        message: "FAILED_EXPLICIT: workflow loop exited before any run completed.",
    };
    while (true) {
        // Load or build the spec.
        let spec;
        if (specPath) {
            try {
                spec = loadWorkflowSpecFromFile(specPath);
                const policyBanner = renderTeamPolicyRunBannerLines(loadTeamPolicyPack(workspaceRoot));
                print([
                    `  Loaded spec: "${spec.name}" (${spec.tasks.length} task(s))`,
                    `  Workspace:   ${workspaceRoot}`,
                    ...policyBanner,
                ]);
            }
            catch (err) {
                // Stabilization P0 / PR-5 (D2 Fix B): extract the error's own
                // message (which already contains "Error: " from the caller's
                // prefix) via `err.message`. `String(err)` on an Error instance
                // yields "Error: <msg>", which combined with our literal "Error:"
                // prefix produced the "Error: Error:" double-prefix bug.
                const message = err instanceof Error ? err.message : String(err);
                // PR-K3: prefer the canonical code carried on WorkflowSpecLoadError;
                // fall back to invalid_op for other throws from loadWorkflowSpecFromFile
                // (e.g. missing "name" / "tasks" shape errors).
                const specLoadCode = err instanceof WorkflowSpecLoadError ? err.code : "invalid_op";
                print([`  Error: ${message}`]);
                if (autoYes) {
                    // PR-K3: emit a deterministic result-file for --output json parity.
                    // Previously `usesteady run <missing>.json --yes --output json`
                    // exited 1 with only stderr text and no JSON; machine consumers
                    // saw nothing. Mirror the end-of-workflow shape so emitJsonResult
                    // can project it to stdout. Fire-and-forget: write failure must
                    // never crash the run.
                    const _resultPath = process.env["USESTEADY_RESULT_PATH"];
                    if (_resultPath) {
                        try {
                            fs.writeFileSync(_resultPath, JSON.stringify({
                                succeeded: false,
                                errorCode: specLoadCode,
                                success: false,
                                error: specLoadCode,
                                failed_at_step: null,
                                executed_steps: 0,
                                total_steps: 0,
                            }), "utf8");
                        }
                        catch { /* non-fatal: result-file write failure must never crash */ }
                    }
                    const record = classifyWorkflowTerminalOutcome({
                        phase: "stopped",
                        explicitFailureReason: message,
                    });
                    persistWorkflowTerminalOutcome(record);
                    return record;
                }
                const retry = await ask(rl, "  Enter a different spec path (or 'exit'): ");
                if (retry.trim().toLowerCase() === "exit") {
                    lastRecord = {
                        outcome: "stopped_by_user",
                        exitCode: 3,
                        message: "STOPPED_BY_USER: workflow run cancelled before start.",
                    };
                    break;
                }
                specPath = retry.trim();
                continue;
            }
        }
        else {
            if (autoYes) {
                const reason = "No spec file provided and --yes requires a spec path.";
                print([`  ${reason}`]);
                const record = classifyWorkflowTerminalOutcome({
                    phase: "stopped",
                    explicitFailureReason: reason,
                });
                persistWorkflowTerminalOutcome(record);
                return record;
            }
            const built = await buildWorkflowSpecInteractively(rl);
            if (built === null) {
                // Interactive exit contract: user typed "exit" at a spec-builder prompt.
                // Record STOPPED_BY_USER so the terminal contract is honored and
                // drop out of the workflow loop cleanly.
                lastRecord = {
                    outcome: "stopped_by_user",
                    exitCode: 3,
                    message: "STOPPED_BY_USER: workflow spec cancelled before start.",
                };
                break;
            }
            spec = built;
        }
        // ─── R1 single-authority safety on the finalized spec ──────────────────
        //
        // Gate the spec through the SAME `gateWorkflowSpecSafety` the web
        // `POST /api/workflow/start` uses, so `run <spec>` (and the NL recovery
        // delegate, which routes a synthesized spec through this same workflow
        // command) refuse dangerous intent identically to the web. Render the
        // `safety` RoutingSurface via `renderSurfaceCli` — the SAME engine object
        // both surfaces consume. Terminal and fail-closed: no retry, exit 1.
        {
            const { gateWorkflowSpecSafety } = await import("../../workflow/spec-safety-gate.js");
            const verdict = gateWorkflowSpecSafety(spec);
            if (verdict.verdict === "block") {
                const { safetySurfaceFromVerdict } = await import("../../workflow/routing-surface-derive.js");
                const { renderSurfaceCli } = await import("../render-surface-cli.js");
                const surface = safetySurfaceFromVerdict(verdict);
                if (surface)
                    print([...renderSurfaceCli(surface)]);
                // --output json parity: emit a deterministic result-file (mirrors the
                // spec-load-error path) so machine consumers see safety_block.
                const _resultPath = process.env["USESTEADY_RESULT_PATH"];
                if (_resultPath) {
                    try {
                        fs.writeFileSync(_resultPath, JSON.stringify({
                            succeeded: false,
                            errorCode: "safety_block",
                            success: false,
                            error: "safety_block",
                            failed_at_step: null,
                            executed_steps: 0,
                            total_steps: spec.tasks.length,
                        }), "utf8");
                    }
                    catch { /* non-fatal: result-file write failure must never crash */ }
                }
                const record = classifyWorkflowTerminalOutcome({
                    phase: "stopped",
                    explicitFailureReason: `Blocked by safety: ${verdict.note ?? verdict.reason ?? "blocked"}`,
                });
                persistWorkflowTerminalOutcome(record);
                return record;
            }
        }
        // ─── #150 credential pre-flight ───────────────────────────────────────
        //
        // Provider-agnostic credential gate. Computed from the spec's task
        // runtimes via the PROVIDERS registry — zero Anthropic-specific code
        // path. Same "live mode" predicate the server endpoint uses, so UI and
        // CLI can never diverge.
        //
        // Rules:
        //   live + missing → error message + non-zero exit (no fallback)
        //   demo + missing → informational hint ("Using demo mode ...") and
        //                    continue with stubs (preserves existing UX)
        const requiredProviders = buildRequiredProviderIds(spec.tasks.map(t => t.runtime ?? spec.defaultRuntime ?? "cursor"));
        const missing = getMissingProviders(requiredProviders);
        const missingLive = missing.filter(p => isProviderLive(p));
        const missingDemoOnly = missing.filter(p => !isProviderLive(p));
        if (missingLive.length > 0) {
            print([
                "",
                `  ✗ Workflow cannot start — missing API key for ${missingLive.length === 1 ? missingLive[0].displayName : `${missingLive.length} providers`}.`,
                "",
                "  This workflow includes tasks that require a live API call, but the",
                "  credential is not configured:",
                "",
            ]);
            for (const p of missingLive) {
                print([
                    `    • ${p.displayName} — set ${p.envKey}${p.setupUrl ? ` (keys: ${p.setupUrl})` : ""}`,
                ]);
            }
            print([
                "",
                "  Configure the key(s) above, then re-run. To run without live AI,",
                "  unset the live-mode toggle for that provider (e.g. USESTEADY_USE_CLAUDE).",
                "",
            ]);
            if (autoYes)
                process.exit(1);
            process.exit(1);
        }
        if (missingDemoOnly.length > 0) {
            // Non-blocking hint. Keeps the existing demo/stub flow working but
            // prevents the silent-confusion failure mode where users think live
            // AI ran when it didn't.
            print([
                "",
                `  ℹ Using demo mode (no API key configured for ${missingDemoOnly.map(p => p.displayName).join(", ")}).`,
                "    To enable live execution, set:",
            ]);
            for (const p of missingDemoOnly) {
                const liveToggle = p.liveModeEnv
                    ? `${p.liveModeEnv}=${p.liveModeEnvExpectedValue ?? "true"}`
                    : null;
                print([
                    `      ${p.envKey}=<key>${liveToggle ? ` and ${liveToggle}` : ""}`,
                ]);
            }
            print([""]);
        }
        // ?? WS6 generic loop ???????????????????????????????????????????????????
        // Phase 11D: createWorkflowRun now starts in "reviewing".
        // The loop renders the pre-flight task list and waits for H confirmation.
        // advanceWorkflowOnConfirm handles reviewing ? startWorkflow / cancelWorkflow.
        // Snapshot audit file position BEFORE the run so we can correlate records
        // written during this workflow only (file-offset approach — no ID threading).
        const auditFile = join(storeDir, "consensus-audit.jsonl");
        const auditOffsetBefore = countAuditLines(auditFile);
        let run = createWorkflowRun(spec);
        let bridgeApprovalProvenance = createBridgeApprovalProvenanceState();
        const workflowPolicies = {
            ...DEFAULT_WORKFLOW_POLICIES,
            workspaceRoot,
        };
        // ─── P2-min: resume verification (if --resume-from was passed) ─────────
        //
        // Authority discipline:
        //   - The token carries no approval state. Even with `--yes` set,
        //     a resume across non-idempotent ops requires the operator's
        //     explicit opt-in via `--reexecute-non-idempotent`.
        //   - Verification is read-only. It probes the filesystem via
        //     existsSync / statSync only.
        //   - On diverged, resume ALWAYS refuses (exit 2). The operator
        //     reconciles manually.
        //
        // Effect on run state when resume is accepted:
        //   - tasks[0..K-1].outcome ← "accepted" (verified already-done)
        //     or "skipped" (token recorded `previously_skipped`).
        //   - run.currentIndex ← K (first not-yet-done task).
        //   - phase stays "reviewing" so the operator still confirms the
        //     remaining workload (or `--yes` proceeds automatically).
        //
        // Persistent token continues to be written after each completed
        // task in the post-iteration hook below.
        let resumedFromTaskIndex = 0;
        if (resumeOptions.resumeFromPath !== undefined) {
            const validation = validateTokenForResume(resumeOptions.resumeFromPath, spec, workspaceRoot);
            if (!validation.ok) {
                if (validation.code === "workflow_already_complete") {
                    print([
                        "",
                        `  Resume token reports the workflow is already complete.`,
                        `  Nothing to resume.`,
                        "",
                    ]);
                    const record = classifyWorkflowTerminalOutcome({
                        phase: "completed",
                        explicitFailureReason: null,
                    });
                    persistWorkflowTerminalOutcome(record);
                    return record;
                }
                print([
                    "",
                    `  ✗ Resume refused (${validation.code}).`,
                    `    ${validation.message}`,
                    "",
                ]);
                const record = classifyWorkflowTerminalOutcome({
                    phase: "stopped",
                    explicitFailureReason: validation.message,
                });
                persistWorkflowTerminalOutcome(record);
                return record;
            }
            const report = verifyResumePoint(validation.token, spec, workspaceRoot);
            if (report.aggregate === "diverged") {
                print([
                    "",
                    `  ✗ Resume refused: workspace state diverged from token.`,
                    `    ${report.diverged} task(s) cannot be verified as already-done.`,
                    `    Run \`usesteady workflow resume-info ${resumeOptions.resumeFromPath} ` +
                        `--spec <spec.json>\` for the full per-task report.`,
                    "",
                ]);
                const record = classifyWorkflowTerminalOutcome({
                    phase: "stopped",
                    explicitFailureReason: "resume refused: task_state_diverged",
                });
                persistWorkflowTerminalOutcome(record);
                return record;
            }
            if (report.aggregate === "needs_reconfirm" && !resumeOptions.reexecuteNonIdempotent) {
                print([
                    "",
                    `  ✗ Resume refused: ${report.reconfirm} task(s) cannot be ` +
                        `idempotency-checked.`,
                    `    The workflow includes non-idempotent ops (append/prepend/replace/` +
                        `run/claude).`,
                    `    Pass --reexecute-non-idempotent to opt in to re-prompting on ` +
                        `those tasks.`,
                    `    Run \`usesteady workflow resume-info\` for the full per-task ` +
                        `report.`,
                    "",
                ]);
                const record = classifyWorkflowTerminalOutcome({
                    phase: "stopped",
                    explicitFailureReason: "resume refused: requires_reconfirm without --reexecute-non-idempotent",
                });
                persistWorkflowTerminalOutcome(record);
                return record;
            }
            // Aggregate is "clean" (or "needs_reconfirm" with --reexecute-non-idempotent).
            // Pre-advance the run state past the verified-completed tasks.
            const completedCount = validation.token.completed_task_count;
            const newTasks = run.tasks.map((t, i) => {
                if (i >= completedCount)
                    return t;
                const finding = report.findings[i];
                const outcome = finding?.verdict === "previously_skipped" ? "skipped" :
                    finding?.verdict === "already_done" ? "accepted" :
                        // For needs_reconfirm tasks under --reexecute-non-idempotent we
                        // still mark them accepted (already-done at original-run time) but
                        // the operator has explicitly opted into the consequences.
                        "accepted";
                return { ...t, outcome };
            });
            run = {
                ...run,
                tasks: newTasks,
                currentIndex: Math.min(completedCount, spec.tasks.length),
            };
            resumedFromTaskIndex = completedCount;
            print([
                "",
                `  Resuming workflow "${spec.name}".`,
                `    Token:      ${validation.token.token_id}`,
                `    Completed:  ${completedCount}/${spec.tasks.length} (verified already-done)`,
                `    Remaining:  ${spec.tasks.length - completedCount} task(s)`,
                "",
            ]);
        }
        if (tuiEnabled)
            setTuiState(run);
        capture("workflow_started", {
            task_count: spec.tasks.length,
            name: spec.name ?? "(unnamed)",
            ...(resumeOptions.resumeFromPath !== undefined ? { resumed_from: resumedFromTaskIndex } : {}),
        });
        // Capture failure note and error code when run enters task_failed.
        // Used by the result-file writer below for structured --output json output.
        let capturedFailureNote = null;
        let capturedErrorCode = null;
        let explicitFailureReason = null;
        // ─── P2-min: token-write hook ─────────────────────────────────────────
        //
        // Tracks the number of tasks in terminal-accepted state at each loop
        // tick. When the count changes (a task just transitioned to
        // "accepted" or "skipped"), write a fresh resume token to
        // <workspace>/.usesteady/resume-tokens/<runId>.json.
        //
        // The token is atomic-renamed into place; a crash mid-write leaves
        // the previous token intact. The token is operator-visible and
        // operator-deletable; nothing in the background re-creates it.
        let lastWrittenCompletedCount = resumedFromTaskIndex;
        const writeTokenIfAdvanced = (currentRun) => {
            const completedNow = currentRun.tasks.filter(t => t.outcome === "accepted" || t.outcome === "skipped" || t.outcome === "skipped_by_intake").length;
            if (completedNow === lastWrittenCompletedCount)
                return;
            if (completedNow === 0)
                return;
            try {
                const token = buildResumeToken({
                    spec,
                    workflowRunId: currentRun.workflowRunId,
                    specPath: specPath ?? "(interactive)",
                    workspaceRoot,
                    completedTaskCount: completedNow,
                    issuedBy: "usesteady-cli",
                    issuedAt: new Date().toISOString(),
                });
                writeResumeToken(workspaceRoot, token);
                lastWrittenCompletedCount = completedNow;
            }
            catch (err) {
                // Token-write failures are non-fatal. The run continues without
                // an updated checkpoint; the operator can still abort + resume
                // from an earlier token. Surfaced once to stderr for diagnostics.
                process.stderr.write(`\n  (warning: could not write resume token: ${err instanceof Error ? err.message : String(err)})\n`);
            }
        };
        while (!isWorkflowTerminal(run)) {
            if (run.phase === "task_failed" && !capturedFailureNote) {
                capturedFailureNote = run.display.failureNote ?? null;
                // PR-K2 (kernel v1): runtime-agnostic errorCode capture.
                //
                // Pre-K2 this block gated on `runtime === "cursor"`, which silently
                // dropped every claude session's `executionResult.errorCode`
                // (including the three consensus codes: consensus_no_quorum,
                // consensus_capability_split, consensus_timeout — coordinator.ts
                // lines 1086-1091). Those failures then fell through to the
                // `failureNote ? "execution_error"` synthesis rule below and lost
                // their classification. The capture is now runtime-agnostic: both
                // CursorExecutionResult and ClaudeExecutionResult carry
                // `errorCode: string` on their `refused_due_to_execution_error`
                // branch (see execution/cursor/cursor-execution-coordinator.ts:174
                // and execution/claude/claude-execution-coordinator.ts:140). The
                // in-operator check is structural, so adding a new runtime later
                // with the same shape requires no change here.
                const csession = run.currentSession;
                if (csession) {
                    const execResult = csession.state.executionResult;
                    if (execResult && "errorCode" in execResult && typeof execResult.errorCode === "string") {
                        capturedErrorCode = execResult.errorCode;
                    }
                }
                // FS-op fast path has no session — read errorCode off the display.
                // This path surfaces adapter-layer refusals like "target_exists"
                // (create on existing) verbatim to --output json.
                if (!capturedErrorCode && typeof run.display.errorCode === "string") {
                    capturedErrorCode = run.display.errorCode;
                }
            }
            // ─── Stabilization P0 / PR-3: batch fail-fast guard ──────────────────
            //
            // Scope (D1): executionPolicy === "batch_fail_fast" is set only for
            // `--batch <file>` and `--json '<array>'`. All other surfaces (draft
            // --prompt, NL single-string, interactive spec builder, single-object
            // --json) keep policy === "interactive" and this branch is a no-op.
            //
            // Two enforcements (D2):
            //
            //   (a) task_failed → force stop, bypass the choose prompt.
            //       Runs BEFORE rendering so the "1. stop / 2. skip / 3. retry"
            //       UI is never printed in batch mode. Failure note + errorCode
            //       were already captured by the block above; applyFailureAction
            //       transitions phase to "stopped" with outcome "stopped" on
            //       the current task. Downstream tasks stay `pending` — the
            //       PR-2 summary naturally reports executed=i, failed_at=i+1.
            //
            //   (b) silent-skip outcomes on any task → promote to hard failure.
            //       Catches the NL-intake leak at coordinator.ts:558-581 where
            //       `not_execute` / `intake_failed` auto-skips a task and recurses
            //       to the next. In batch mode this is a contract violation; we
            //       capture an explicit failure reason and force phase="stopped".
            //
            // Neither branch changes error codes (PR-1 invariant) or the summary
            // shape (PR-2 invariant). Interactive multi-step runs are unaffected.
            if (executionPolicy === "batch_fail_fast") {
                if (run.phase === "task_failed") {
                    run = applyFailureAction(run, "stop");
                    if (tuiEnabled)
                        setTuiState(run);
                    continue;
                }
                const leakIdx = run.tasks.findIndex(t => t.outcome === "skipped_by_intake" ||
                    t.outcome === "skipped" ||
                    t.outcome === "rejected");
                if (leakIdx !== -1 && run.phase !== "stopped") {
                    const leakOutcome = run.tasks[leakIdx].outcome;
                    explicitFailureReason =
                        `batch fail-fast: task ${leakIdx + 1} produced outcome ` +
                            `"${leakOutcome}" without a hard failure; batch mode ` +
                            `forbids silent continuation.`;
                    if (!capturedFailureNote)
                        capturedFailureNote = explicitFailureReason;
                    run = { ...run, phase: "stopped" };
                    if (tuiEnabled)
                        setTuiState(run);
                    break;
                }
            }
            // F10-W2: when the loop will auto-confirm every gate (--yes), the
            // task_ready frame is audit/execution information, not a decision
            // surface — render it with the non-actionable `WILL RUN` header
            // instead of `APPROVE?`. Interactive runs (autoYes=false) and the
            // web surface keep the `APPROVE?` decision header unchanged.
            const frame = renderWorkflowFrame(run, { auditTrailOnly: autoYes });
            print(frame.lines);
            if (!frame.prompt) {
                // Transient phase (running, task_approved) ? auto-advance without I/O.
                if (run.phase === "running") {
                    run = advanceWorkflow(run, DEFAULT_WORKFLOW_POLICIES.cursorPolicy, DEFAULT_WORKFLOW_POLICIES.claudeOCDPolicy, DEFAULT_WORKFLOW_POLICIES.claudeToolPolicy);
                    if (tuiEnabled)
                        setTuiState(run);
                }
                else {
                    // Any no-prompt non-running phase is an explicit execution contract failure.
                    explicitFailureReason = `workflow reached no-prompt non-running phase "${run.phase}"`;
                    if (!capturedFailureNote)
                        capturedFailureNote = explicitFailureReason;
                    break;
                }
                continue;
            }
            // Generic dispatch — no runtime branching (WS6).
            // In autoYes (--yes) mode: all confirms auto-approve, choose picks option 1.
            //
            // S1 / friction #21: under --yes, the workflow loop must NOT echo the
            // frame's prompt back to stdout as if the user answered it. The single
            // user-visible audit line for --yes is emitted once at the entry layer
            // (use-steady.ts processDraftInput / processJsonInput / processNLInput).
            // Echoing again here makes it look like the system is impersonating
            // the user's answer per-frame, which breaks trust. The frame headers
            // (REVIEW, WILL RUN, SYSTEM WILL, COMPLETED) still print via
            // print(frame.lines) above; only the cosmetic "(y/n) → yes" / "→ 1"
            // echoes are suppressed. State machine, persisted audit, and exit
            // codes are unchanged.
            //
            // F10-W2: under autoYes the task_ready header prints as `WILL RUN`
            // (audit-truthful: the gate is auto-confirmed upstream, so no
            // approval can be supplied here). Interactive runs keep `APPROVE?`.
            if (frame.prompt.kind === "confirm") {
                // PENDING_APPROVAL_BRIDGE_LANE_A_V1 — route this gate's decision through
                // the Portal when opted in. Strictly bounded: only on a `confirm` gate
                // (this branch), never under --yes (no human to wait for), and never for a
                // break-glass run (which bypasses per-step approval by design). Any
                // fail-closed outcome returns null and falls through to the local prompt
                // below — the authoritative fallback. The remote decision is fed into the
                // SAME `advanceWorkflowOnConfirm` gate the local prompt uses; a remote
                // approve is re-validated locally before anything runs.
                if (approvalsConfig.enabled && !autoYes && run.mode !== "break_glass") {
                    // Shared helper (S0): same emit/poll/fallback as web confirm when opted in.
                    const remote = await resolveRemoteApprovalDecision(run, approvalsConfig, {
                        onStatus: print,
                        retirementReadback: {
                            storeDir: process.env["USESTEADY_STORE_DIR"]?.trim() ?? "",
                            readEnvelopeById: getEnvelopeById,
                        },
                    });
                    if (remote !== null) {
                        // P1 authority carry: preserve the consumed decision's evidence
                        // (verified assertion or honest self-asserted status) durably.
                        appendPortalAuthorityEvidence(storeDir, {
                            recorded_at: new Date().toISOString(),
                            path: "pending_approval",
                            verification: remote.authority.status === "portal_signed_verified"
                                ? "portal_signed_verified"
                                : remote.authority.status === "verification_failed"
                                    ? "verification_failed"
                                    : "self_asserted",
                            ...("reason" in remote.authority ? { reason: remote.authority.reason } : {}),
                            decision_id: remote.entry.id ?? null,
                            organization_id: approvalsConfig.token,
                            run_id: run.workflowRunId,
                            step_index: remote.entry.step_index,
                            decision: remote.entry.decision,
                            decided_at: remote.entry.decided_at,
                            ...(remote.authority.status === "portal_signed_verified"
                                ? {
                                    key_id: remote.authority.assertion.payload.key_id,
                                    assertion: remote.authority.assertion,
                                }
                                : {
                                    authority_subject_id: null,
                                    key_id: null,
                                    ...(remote.entry.authority_assertion !== undefined
                                        ? { assertion: remote.entry.authority_assertion }
                                        : {}),
                                }),
                        });
                        if (remote.decision === "yes") {
                            bridgeApprovalProvenance = recordBridgeApprovalDecision(bridgeApprovalProvenance, remote.entry, remote.authority);
                        }
                        run = await advanceWorkflowOnConfirm(run, remote.decision === "yes", plugins, storeDir, workflowPolicies, undefined, remote.decision === "yes" &&
                            remote.entry.decision_relation === "retire_model_position"
                            ? {
                                relation: "retire_model_position",
                                resolvingEvidenceIds: remote.entry.resolving_evidence_ids ?? [],
                                authorityEvidenceStatus: remote.authority.status === "portal_signed_verified"
                                    ? "portal_signed_verified"
                                    : "self_asserted",
                                ...(remote.entry.id ? { authorityDecisionId: remote.entry.id } : {}),
                                ...(remote.authority.status === "portal_signed_verified" &&
                                    remote.authority.assertion.schema ===
                                        "usesteady.authority_assertion.v3"
                                    ? {
                                        mappedRelations: remote.authority.assertion.payload.decision_origin.retirement_basis_relations.map((relation) => ({
                                            modelPositionId: relation.model_position.model_position_id,
                                            positionHash: relation.model_position.position_hash,
                                            evidenceBasisId: relation.resolving_evidence.evidence_basis_id,
                                            evidenceBasisHash: relation.resolving_evidence.evidence_basis_hash,
                                        })),
                                    }
                                    : {}),
                            }
                            : undefined);
                        writeTokenIfAdvanced(run);
                        if (tuiEnabled) {
                            const consensus = run.phase === "task_failed"
                                ? deriveConsensusEntries(auditFile, auditOffsetBefore) : undefined;
                            setTuiState(run, consensus);
                        }
                        continue;
                    }
                    // remote === null: fail-closed → fall through to the local prompt.
                }
                const answer = autoYes ? "yes" : await ask(rl, `  ${frame.prompt.question} `);
                if (!autoYes && !process.stdin.isTTY && answer.trim() === "") {
                    run = { ...run, phase: "stopped" };
                    if (tuiEnabled)
                        setTuiState(run);
                    break;
                }
                const parsed = parseConfirmInput(answer);
                if (!autoYes && parsed === "invalid") {
                    print(["  Invalid response. Enter yes, no, or exit."]);
                    continue;
                }
                if (!autoYes && parsed === "exit") {
                    run = { ...run, phase: "stopped" };
                    if (tuiEnabled)
                        setTuiState(run);
                    break;
                }
                run = await advanceWorkflowOnConfirm(run, autoYes ? true : parsed === "yes", plugins, storeDir, workflowPolicies);
                writeTokenIfAdvanced(run);
                if (tuiEnabled) {
                    const consensus = run.phase === "task_failed"
                        ? deriveConsensusEntries(auditFile, auditOffsetBefore) : undefined;
                    setTuiState(run, consensus);
                }
            }
            else if (frame.prompt.kind === "choose") {
                print([`  ${frame.prompt.question}`]);
                frame.prompt.choices.forEach((c, i) => print([`    ${i + 1}. ${c}`]));
                const answer = autoYes ? "1" : await ask(rl, "  Enter number: ");
                if (!autoYes && !process.stdin.isTTY && answer.trim() === "") {
                    run = { ...run, phase: "stopped" };
                    if (tuiEnabled)
                        setTuiState(run);
                    break;
                }
                if (!autoYes && answer.trim().toLowerCase() === "exit") {
                    run = { ...run, phase: "stopped" };
                    if (tuiEnabled)
                        setTuiState(run);
                    break;
                }
                // S1 / friction #21: no autoYes echo (see confirm-branch comment above).
                const n = parseChoice(answer);
                if (isNaN(n)) {
                    if (!autoYes)
                        print(["  Invalid selection. Enter a number or exit."]);
                    continue;
                }
                run = await advanceWorkflowOnChoice(run, n, plugins, storeDir, workflowPolicies);
                writeTokenIfAdvanced(run);
                if (tuiEnabled) {
                    const consensus = run.phase === "task_failed"
                        ? deriveConsensusEntries(auditFile, auditOffsetBefore) : undefined;
                    setTuiState(run, consensus);
                }
            }
        }
        capture(`workflow_${run.phase}`, {
            task_count: spec.tasks.length,
            name: spec.name ?? "(unnamed)",
        });
        // Persist the terminal workflow run as a ucp.workflow_run.v1 envelope.
        // Fire-and-forget: persistence failure must not block terminal rendering.
        persistWorkflowRun(run, storeDir);
        // Build structured workflow result once and use it for:
        //   1) current --output json result-file path (existing behavior), and
        //   2) PR3 shadow-mode ucp.execution_result.v1 envelope (parity-only).
        const _skippedByIntake = run.tasks.some(t => t.outcome === "skipped_by_intake");
        const _succeeded = run.phase === "completed" && capturedFailureNote === null && !_skippedByIntake;
        // PR-K2 (kernel v1): single normalization choke point for the final
        // error code. `finalizeErrorCode` preserves the pre-K2 precedence
        // rules (capturedErrorCode → synthesized "execution_error" on
        // failureNote → synthesized "parse_error" on skipped_by_intake → null),
        // and then runs the result through the canonical enum normalizer so
        // every downstream consumer (ExecutionSummary.error, WorkflowResult
        // .errorCode, KernelResult.error, shadow envelope, --output json)
        // observes either a known canonical code or the defensive "unknown"
        // fallback. No public shape change — the type stays `string | null`.
        const _errorCode = finalizeErrorCode({
            capturedErrorCode,
            capturedFailureNote,
            skippedByIntake: _skippedByIntake,
        });
        // Stabilization P0 / PR-2: deterministic execution summary.
        // Output-only; does NOT change any success/error semantics.
        // Legacy keys (succeeded, errorCode) are preserved verbatim for
        // backward compatibility of any result-file consumers. The three
        // new fields (failed_at_step, executed_steps, total_steps) are
        // strictly additive, as is the success/error pair which mirrors
        // the already-public --output json surface (emitJsonResult).
        const _summary = buildExecutionSummary({
            taskOutcomes: run.tasks.map(t => t.outcome),
            errorCode: _errorCode,
            // Issue #42 -- pass each task's accepted-warning counter so the
            // end-of-run summary acknowledges any OCD conflicts the user
            // accepted along the way. The conflict frame is intentionally
            // non-blocking; this surfaces it in the final outcome so
            // success ≠ "no warnings."
            taskConflictsAccepted: run.tasks.map(t => t.conflictsAccepted),
        });
        const _workflowResult = {
            succeeded: _succeeded,
            errorCode: _errorCode,
            success: _summary.success,
            error: _summary.error,
            failed_at_step: _summary.failed_at_step,
            executed_steps: _summary.executed_steps,
            total_steps: _summary.total_steps,
            // Issue #42 -- propagate the accepted-warnings counter into the
            // result file so `emitJsonResult` can surface it on the public
            // `--output json` stream. Strictly additive: pre-#42 consumers
            // reading the five fields above are unaffected; new consumers
            // gain `warnings_accepted` so they can reflect the same trust
            // signal the human banner now shows. The counter is always set
            // (zero when the run had no OCD conflicts accepted), so machine
            // consumers can read it unconditionally without back-compat
            // gymnastics.
            warnings_accepted: _summary.warnings_accepted,
            ...(run.lastCommandResult
                ? {
                    stdout: run.lastCommandResult.stdout,
                    stderr: run.lastCommandResult.stderr,
                    exitCode: run.lastCommandResult.exitCode,
                }
                : {}),
        };
        // Write structured outcome for --output json mode (USESTEADY_RESULT_PATH).
        // Fire-and-forget: write failure must never crash the run.
        const _resultPath = process.env["USESTEADY_RESULT_PATH"];
        if (_resultPath) {
            try {
                fs.writeFileSync(_resultPath, JSON.stringify(_workflowResult), "utf8");
            }
            catch { /* non-fatal: never crash the run on result-file write failure */ }
        }
        // PR3 shadow mode: persist execution result envelope for parity checks.
        // Live CLI output ownership remains unchanged.
        try {
            persistEnvelope(storeDir, mapWorkflowExecutionResultToEnvelope(_workflowResult));
        }
        catch { /* non-fatal: shadow envelope persistence must never crash run */ }
        // PR-K1 (kernel v1) + B2: build the deterministic replay artifact ONCE so both
        // the Portal report (replay_ref) and the on-disk persistence below use the exact
        // same checksum. B2 (failed-run replayability): every terminal run now builds an
        // artifact so failures are recorded and integrity-replayable, not just successes.
        // The Portal-facing replayRef below stays success-only (P0-55 semantics unchanged)
        // by gating on _kernelRunSucceeded, NOT on artifact presence. Guarded: never
        // crashes the run.
        let _kernelArtifact = null;
        let _kernelRunSucceeded = false;
        try {
            const _kernelResult = buildKernelResultFromRun(run, _succeeded, _errorCode);
            _kernelRunSucceeded = _kernelResult.success;
            _kernelArtifact = buildKernelArtifact(run.spec, _kernelResult);
        }
        catch { /* non-fatal: kernel artifact build must never crash run */ }
        // P0-49 Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1): opt-in,
        // best-effort report of this run's outcome to the Portal. Awaited before
        // process exit so the HTTPS POST completes; opt-in resolution, payload build,
        // and transport are fully guarded inside reportRunToPortal so a reporting
        // failure can NEVER affect the local run (INV-ERB-P1). Sends ONLY when
        // --report-to-portal is set AND USESTEADY_PORTAL_RUNS_URL + USESTEADY_PORTAL_TOKEN are set.
        if (reportToPortal) {
            try {
                const ucpRootId = resolveReportUcpRootId(run, storeDir);
                const reportIntent = primaryTaskInput(run);
                const coreUrl = process.env[USESTEADY_CORE_URL_ENV]?.trim();
                if (coreUrl && reportIntent.trim()) {
                    try {
                        await postCoreUnderstandWorkflow({
                            coreBaseUrl: coreUrl,
                            intent: reportIntent,
                            workspaceRoot,
                        });
                    }
                    catch { /* best-effort: hosted Core store population */ }
                }
                const anyFailed = run.tasks.some(t => t.outcome === "rejected" || t.outcome === "stopped");
                const outcome = _succeeded ? "success" : anyFailed ? "failure" : "partial";
                const breakGlass = run.mode === "break_glass";
                const reportSnapshot = captureCertificationChainSnapshot(storeDir, ucpRootId);
                const approvalProvenance = resolveExecutionReturnApprovalProvenance(bridgeApprovalProvenance, storeDir, run.workflowRunId);
                await reportRunToPortal({
                    flag: true,
                    buildInput: {
                        runId: run.workflowRunId,
                        ucpRootId,
                        workflowName: spec.name,
                        outcome,
                        executedAt: new Date().toISOString(),
                        decisionSummary: unavailableDecisionSummary(run.tasks.length, breakGlass),
                        deliveryReportSummary: deliveryReportSummaryFromOutcomes(run.tasks.map((t) => t.outcome)),
                        approvalRecord: {
                            mode: breakGlass ? "break_glass" : "per_step",
                            approver: approvalProvenance.approver,
                            approved_at: approvalProvenance.approved_at,
                            // P1 authority carry: honest evidence-status label + the preserved
                            // assertion when one was verified. Never claims verified identity.
                            authority_status: approvalProvenance.authority_status,
                            ...(approvalProvenance.authority_assertion
                                ? { authority_assertion: approvalProvenance.authority_assertion }
                                : {}),
                        },
                        chainCount: reportSnapshot.chainCount,
                        chainAvailable: true,
                        chainVerification: reportSnapshot.chainVerification,
                        ...(() => {
                            const ov = outcomeVerificationFromTasks(run.tasks.map((t) => t.outcomeVerification));
                            return ov ? { outcomeVerification: ov } : {};
                        })(),
                        // P0-55: surface the deterministic-replay reference. reconstructable
                        // iff the run succeeded (success path); never implies the Portal can
                        // replay. B2 records failed-run artifacts on disk too, but the Portal
                        // signal stays success-only here so P0-55 semantics are unchanged.
                        replayRef: {
                            reconstructable: _kernelRunSucceeded,
                            checksum: _kernelRunSucceeded ? (_kernelArtifact?.checksum ?? null) : null,
                        },
                    },
                });
            }
            catch { /* best-effort: never affects the run */ }
        }
        // PR-K1 (kernel v1) + B2: persist the deterministic replay artifact for EVERY
        // terminal run (success and failure), so failures are integrity-replayable via
        // `usesteady replay <file>`. Uses the same artifact built above (single source of
        // the checksum the replay command verifies against). Fire-and-forget: never
        // crashes the run.
        try {
            if (_kernelArtifact) {
                persistKernelArtifact(_kernelArtifact, storeDir);
            }
        }
        catch { /* non-fatal: kernel artifact persistence must never crash run */ }
        // Print terminal frame.
        print(renderWorkflowFrame(run).lines);
        // Print consensus explanation for records written during this run only.
        printConsensusExplanation(auditFile, auditOffsetBefore);
        if (run.phase === "task_failed" && !capturedFailureNote) {
            capturedFailureNote = "workflow reached task_failed without a concrete failure note";
        }
        // Stabilization P0 / PR-1: pass the captured failure reason through
        // unconditionally. A `phase === "stopped"` with a non-null failure
        // reason means the workflow was forced to stop *because a tool or
        // adapter failed* (e.g. applyFailureAction("stop") after task_failed,
        // or the no-prompt non-running branch above). The classifier's
        // load-bearing invariant is that `explicitFailureReason` strictly
        // dominates `phase`; nulling it here re-introduced the
        // STOPPED_BY_USER misclassification that blamed the user for tool
        // failures. User-initiated stops (exit/EOF at a prompt, user
        // cancelling the spec builder) never set either variable, so they
        // still classify correctly as stopped_by_user.
        const terminalRecord = classifyWorkflowTerminalOutcome({
            phase: run.phase,
            explicitFailureReason: explicitFailureReason ?? capturedFailureNote,
        });
        persistWorkflowTerminalOutcome(terminalRecord);
        lastRecord = terminalRecord;
        // PR-K3: the pre-K3 CLI printed the classifier's machine-vocabulary
        // line to stdout —
        //
        //   Terminal outcome: <completed|stopped_by_user|failed_explicit>
        //   <COMPLETED:/STOPPED_BY_USER:/FAILED_EXPLICIT: ...>
        //
        // — immediately before the PR-2 human summary block, so every run
        // emitted two different vocabularies for the same outcome, and the
        // FAILED_EXPLICIT line on failure leaked the raw adapter detail
        // (e.g. `File not found: <absolute host path>`). The PR-2 block
        // below already expresses the same truth using the canonical K2
        // error code (`Failed: file_not_found / Failed at step: 1 / Steps
        // executed: X / Y`), so the classifier text is no longer printed.
        //
        // Kept unchanged: `persistWorkflowTerminalOutcome(terminalRecord)`
        // above, the on-disk terminal record file, the classifier's message
        // strings themselves, and the exit code propagation through
        // `terminalRecord.exitCode`. Only the stdout emission is dropped.
        //
        // Stabilization P0 / PR-2: deterministic end-of-run summary block.
        // D5: exactly ONE summary per run; this is the last output block
        // before the per-run return or the "Run another workflow?" prompt.
        print(renderExecutionSummaryLines(_summary));
        // --yes mode: run exactly once, then exit.
        if (autoYes)
            return terminalRecord;
        // Non-interactive stdin cannot support "run another workflow" prompts.
        // Exit deterministically with the single terminal outcome from this run.
        if (!process.stdin.isTTY)
            return terminalRecord;
        // Prompt to run another workflow or quit.
        const again = await ask(rl, "  Run another workflow? (y/n or 'exit'): ");
        const parsedAgain = parseConfirmInput(again);
        if (parsedAgain === "exit" || parsedAgain === "no") {
            break;
        }
        if (parsedAgain === "invalid") {
            print(["  Invalid response. Enter yes, no, or exit."]);
            continue;
        }
        // If spec was from a file, offer to re-use or provide a new path.
        if (specPath) {
            const newPath = await ask(rl, `  Spec path (Enter to re-use "${specPath}"): `);
            if (newPath.trim())
                specPath = newPath.trim();
        }
        else {
            specPath = undefined;
        }
    }
    persistWorkflowTerminalOutcome(lastRecord);
    return lastRecord;
}
// ??? History loop (Phase 10C) ?????????????????????????????????????????????????
/**
 * runHistoryLoop ? read-only CLI loop over the workflow history read model.
 *
 * Flow:
 *   1. Load WorkflowHistorySummary[] from storeDir (Tier 1 ? cheap).
 *   2. renderHistoryFrame({ kind: "list" }) ? print + choose prompt.
 *   3. H selects a run by number.
 *   4. Load WorkflowAuditRecord for the selected run (Tier 2 ? deep).
 *   5. renderHistoryFrame({ kind: "detail" }) ? print + confirm prompt.
 *   6. H presses Enter ? back to list. "exit" ? quit.
 *
 * No authority. No writes. storeDir is read-only.
 */
async function runHistoryLoop(rl, storeDir) {
    while (true) {
        const summaries = getWorkflowHistories(storeDir);
        const listFrame = renderHistoryFrame({ kind: "list", summaries });
        print(listFrame.lines);
        // HR3: empty list has no prompt ? exit the loop cleanly.
        if (!listFrame.prompt)
            break;
        // Generic dispatch ? no view-kind branching needed (WS6 contract holds here too).
        if (listFrame.prompt.kind !== "choose")
            break;
        const answer = await ask(rl, "  Enter number (or 'exit'): ");
        if (answer.trim().toLowerCase() === "exit")
            break;
        const n = parseChoice(answer);
        if (isNaN(n))
            continue;
        const selected = summaries[n - 1];
        if (!selected) {
            print(["  Invalid selection."]);
            continue;
        }
        const record = getWorkflowAuditRecord(storeDir, selected.workflowRunId);
        if (!record) {
            print(["  Audit record not found."]);
            continue;
        }
        // Show detail ? confirm prompt returns to list, exit leaves the loop.
        const detailFrame = renderHistoryFrame({ kind: "detail", record });
        print(detailFrame.lines);
        if (detailFrame.prompt?.kind === "confirm") {
            const back = await ask(rl, `  ${detailFrame.prompt.question} `);
            if (back.trim().toLowerCase() === "exit")
                break;
            // Any other answer ? back to list.
        }
    }
}
// ??? Entry point ??????????????????????????????????????????????????????????????
async function main() {
    // #150: hydrate process.env from ~/.usesteady/config.json before anything
    // else so that pre-existing users (who stored keys via `npx usesteady setup`)
    // get the same deterministic credential view as users who export env vars
    // directly. Env vars already set always win — this never overwrites.
    hydrateEnvFromConfig();
    const args = process.argv.slice(2);
    const runtime = args[0] === "claude" ? "claude"
        : args[0] === "workflow" ? "workflow"
            : args[0] === "history" ? "history"
                : args[0] === "onboarding" ? "onboarding"
                    : "cursor";
    // --prefill "…" — used by direct-mode entry (npx usesteady "some request")
    const prefillIdx = args.indexOf("--prefill");
    const prefill = prefillIdx >= 0 ? args.slice(prefillIdx + 1).join(" ") : undefined;
    // --yes — non-interactive execution mode (CI, scripts)
    const autoYes = args.includes("--yes");
    // --report-to-portal — P0-49 Execution Return Bridge opt-in (default off,
    // INV-ERB-P1). A completed run reports its outcome to the Portal ONLY when
    // this flag is present AND USESTEADY_PORTAL_RUNS_URL + USESTEADY_PORTAL_TOKEN
    // are set. The send is best-effort and never affects the local run. The bin
    // (use-steady.ts) propagates the flag via env across the import boundary; the
    // direct `workflow` subcommand path is covered by the argv check.
    const reportToPortal = process.env["USESTEADY_REPORT_TO_PORTAL"] === "1" || args.includes("--report-to-portal");
    // --pending-approval-bridge — PENDING_APPROVAL_BRIDGE_LANE_A_V1 opt-in (default
    // off). When set AND the approvals transport env is configured, per-step confirm
    // gates route through the Portal; otherwise the local approval flow is unchanged.
    // use-steady.ts propagates the flag via env across the import boundary; the direct
    // `workflow` subcommand path is covered by the argv check.
    const pendingApprovalBridge = process.env["USESTEADY_PENDING_APPROVAL_BRIDGE"] === "1" ||
        args.includes("--pending-approval-bridge");
    // M5 §13 commit 4: single-owner SessionController replaces createRL().
    // The controller owns ONE readline.Interface against process.stdin for the
    // whole process lifetime. main()'s finally block calls `ctrl.shutdown()`
    // exactly once in place of the previous `rl.close()`.
    const rl = createController(autoYes);
    // PR-K3: pass autoYes so printBanner can suppress the workflow/history
    // interactive banner when --yes is active (which guarantees no
    // interactive prompts will ever fire).
    printBanner(runtime, autoYes);
    try {
        if (runtime === "onboarding") {
            const root = args[1] ?? process.cwd();
            // Gate on Claude key ? first-time users must set one up.
            const key = detectClaudeKey();
            if (!key) {
                // M5 §13 commit 5 lands here: runSetupPrompt now accepts the
                // SessionController directly. This is the GH-22 fix point — the
                // credential gate no longer borrows a raw readline.Interface, so a
                // mid-menu error cannot race a second `createInterface` and kill
                // stdin. The session stays alive through any gate failure.
                const setupResult = await runSetupPrompt(rl);
                // Only the explicit [exit]/quit/:q/q keyword terminates the session.
                // [1] paste key, [2] how-to-get, and [3] skip all return "continue"
                // so the user lands in the same onboarding + REPL flow they'd get
                // with a key already configured. Without a key, deterministic edits
                // still work; LLM-assisted paths surface their own setup hint.
                if (setupResult === "exit")
                    return;
                // "continue" — fall through to onboarding + cursor REPL below.
            }
            const sessionId = await runOnboarding(rl);
            // Interactive exit contract: null = user typed "exit" during onboarding.
            // Return cleanly; main()'s finally block handles ctrl.shutdown() + Goodbye.
            if (sessionId === null)
                return;
            await runCursorLoop(rl, root, undefined, sessionId);
        }
        else if (runtime === "workflow") {
            // P2-min: extract --resume-from <path> and --reexecute-non-idempotent
            // BEFORE positional resolution so they don't pollute the spec/root
            // positionals.
            let resumeFromPath;
            let reexecuteNonIdempotent = false;
            const filteredArgs = [];
            for (let i = 0; i < args.length; i++) {
                const tok = args[i];
                if (tok === "--resume-from") {
                    const next = args[i + 1];
                    if (next === undefined) {
                        process.stderr.write("\n  Error: --resume-from requires a token path.\n\n");
                        process.exit(2);
                    }
                    resumeFromPath = next;
                    i += 1;
                    continue;
                }
                if (tok === "--reexecute-non-idempotent") {
                    reexecuteNonIdempotent = true;
                    continue;
                }
                filteredArgs.push(tok);
            }
            // args[1] is optional spec.json path; args[2] is optional workspace root.
            // Filter out --yes when resolving positional path/root args.
            const positional = filteredArgs.slice(1).filter(a => a !== "--yes" && a !== "--report-to-portal" && a !== "--pending-approval-bridge");
            const rawSpecPath = positional[0]?.endsWith(".json") ? positional[0] : undefined;
            // Stabilization P0 / PR-5 (D2 Fix A): when the user passes BOTH
            // a spec path AND an explicit workspace-root positional, resolve
            // a relative spec against that workspaceRoot — previously it was
            // always resolved against process.cwd(), which silently failed
            // for `usesteady run spec.json /some/root` when spec.json lived
            // inside /some/root. Single-arg behavior (`run spec.json` or
            // `run ./sub/spec.json` with only one positional) is preserved
            // byte-for-byte via the `hasExplicitWorkspaceRoot` flag below.
            const hasExplicitWorkspaceRoot = rawSpecPath !== undefined && positional.length >= 2;
            const root = (rawSpecPath ? positional[1] : positional[0]) ?? process.cwd();
            const specPath = resolveWorkflowSpecPath({
                rawSpecPath,
                workspaceRoot: root,
                hasExplicitWorkspaceRoot,
            });
            // Stabilization P0 / PR-3: resolve executionPolicy from env. The
            // env var is the single channel use-steady.ts uses to cross the
            // `await import("./main.js")` boundary (see execution-policy.ts).
            const executionPolicy = resolveExecutionPolicy();
            const resumeOpts = {
                ...(resumeFromPath !== undefined ? { resumeFromPath } : {}),
                reexecuteNonIdempotent,
            };
            const terminal = await runWorkflowLoop(rl, specPath, root, autoYes, executionPolicy, resumeOpts, reportToPortal, pendingApprovalBridge);
            process.exitCode = terminal.exitCode;
        }
        else if (runtime === "history") {
            // args[1] is optional store dir; defaults to resolveStoreDir().
            const storeDir = args[1] ?? resolveStoreDir();
            await runHistoryLoop(rl, storeDir);
        }
        else if (runtime === "cursor") {
            const root = (prefill ? args[1] : args[1]) ?? process.cwd();
            await runCursorLoop(rl, root, prefill);
        }
        else {
            await runClaudeLoop(rl);
        }
    }
    finally {
        rl.shutdown();
    }
    print(["\n  Goodbye.\n"]);
}
// S1 / friction #32 / #33 — await delegated workflow completion.
//
// `use-steady.ts` delegates batch / --json / --prompt / argv runs into this
// module via `await import("./main.js")` and then immediately reads the
// terminal-outcome file at `USESTEADY_WORKFLOW_OUTCOME_PATH`. ESM dynamic
// import resolves as soon as module top-level evaluation completes, NOT
// when `main()` settles — without a top-level await, the parent's read
// races the child's write. For batches with ~4+ ops the parent loses the
// race, sees the file missing, emits "missing terminal outcome from
// delegated workflow run" and `process.exit(1)`s, killing the in-flight
// child mid-batch and leaving disk in a partial state with no verdict
// (violates K3 single-summary + the no-partial-without-verdict invariant).
//
// We expose `_runComplete` so the parent can `await mod._runComplete`
// after the import. The promise mirrors the previous fire-and-forget
// chain exactly: `.catch` still emits `Fatal:` and `process.exit(1)` on
// throws (so genuine failures still terminate as before), and `.finally`
// still drains PostHog. Direct binary invocation (`node dist/.../main.js
// workflow ...`) is unaffected — `_runComplete` is awaited by the
// importer if it chooses to; nothing in this module's behaviour
// otherwise changes.
export const _runComplete = main()
    .catch(err => {
    process.stderr.write(`\nFatal: ${String(err)}\n`);
    process.exit(1);
})
    .finally(() => { phShutdown().catch(() => { }); });
//# sourceMappingURL=main.js.map