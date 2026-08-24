/**
 * OpenAI-Compatible Agent Adapter.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   A ClaudeAgentPlugin implementation backed by any OpenAI-compatible API.
 *   Covers OpenAI models (GPT-4o, o1, etc.) and OpenAI-compatible endpoints
 *   such as xAI/Grok (https://api.x.ai/v1), Together, Fireworks, etc.
 *
 *   Translates ClaudeDeliveryRequest → OpenAI chat completions with function
 *   calling, then maps the response back to ClaudeDeliveryResponse.
 *
 * ── Why "OpenAi-compatible" not "OpenAI" ─────────────────────────────────────
 *
 *   The baseURL constructor option makes the runtime target configurable.
 *   Naming it "Compatible" avoids the future confusion of an adapter named
 *   "OpenAI" that is also talking to xAI or another provider.
 *
 * ── What this adapter does ────────────────────────────────────────────────────
 *
 *   1. Builds the same system prompt as ClaudeApiAdapter (from artifact constraints).
 *   2. Builds the user message from taskSpec ONLY (never from raw user input, A4).
 *   3. Maps allowedTools names to OpenAI function schemas.
 *   4. Always includes request_scope_clarification as a gate protocol function.
 *   5. Calls the OpenAI chat completions endpoint.
 *   6. Maps the response to ClaudeDeliveryResponse:
 *      - finish_reason "stop"        → accepted  (sessionId = completion.id)
 *      - tool_calls + scope function → refused_due_to_scope with candidates
 *      - tool_calls + other function → accepted (model used a task tool)
 *      - API error / timeout         → refused_due_to_execution_error
 *
 * ── Model Insertion Policy ────────────────────────────────────────────────────
 *
 *   Real API calls are made only when USESTEADY_USE_OPENAI_COMPAT === "true".
 *   When unset, the bypass plugin is used. In CI, callers pass ClaudeStubAdapter
 *   as the bypass to keep behaviour deterministic.
 *
 * ── Phase A locked truths (enforced here) ────────────────────────────────────
 *
 *   A1 — executionDomain is used as-is from the artifact. Never reclassified.
 *   A2 — networkAccess "deny" is enforced at the system prompt level.
 *   A3 — On interruption/timeout, code = "session_interrupted".
 *   A4 — User message is built from artifact.taskSpec only.
 *
 * See: src/claude/adapters/multi-llm-types.ts — normalization layer
 */
import OpenAI from "openai";
// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 30_000;
// ─── Adapter ──────────────────────────────────────────────────────────────────
/**
 * OpenAiCompatibleAgentAdapter — ClaudeAgentPlugin backed by an OpenAI-compatible API.
 *
 * OpenAI production:
 *   const adapter = new OpenAiCompatibleAgentAdapter({ apiKey: process.env.OPENAI_API_KEY! });
 *
 * xAI / Grok:
 *   const adapter = new OpenAiCompatibleAgentAdapter({
 *     apiKey:  process.env.XAI_API_KEY!,
 *     baseURL: "https://api.x.ai/v1",
 *     model:   "grok-3",
 *   });
 *
 * CI (model disabled):
 *   const adapter = new OpenAiCompatibleAgentAdapter({
 *     apiKey: "ci-key",
 *     bypass: ClaudeStubAdapter.accepted("ci-session"),
 *   });
 */
export class OpenAiCompatibleAgentAdapter {
    client;
    model;
    maxTokens;
    bypass;
    constructor(config) {
        this.client = config._openai ?? new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        this.model = config.model ?? DEFAULT_MODEL;
        this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
        this.bypass = config.bypass;
    }
    async receive(request) {
        if (!isOpenAiCompatEnabled() && this.bypass !== undefined) {
            return this.bypass.receive(request);
        }
        const { artifact } = request;
        const systemPrompt = buildSystemPrompt(artifact);
        const userMessage = buildUserMessage(artifact.taskSpec);
        const tools = resolveTools(artifact.allowedTools);
        try {
            const completion = await this.client.chat.completions.create({
                model: this.model,
                max_tokens: this.maxTokens,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
                tools,
                tool_choice: "auto",
            });
            return mapCompletionResponse(completion, artifact);
        }
        catch (err) {
            return mapApiError(err);
        }
    }
    get isLive() {
        return isOpenAiCompatEnabled() || this.bypass === undefined;
    }
}
// ─── Model insertion policy ───────────────────────────────────────────────────
function isOpenAiCompatEnabled() {
    // USESTEADY_USE_LLM is the canonical, provider-neutral opt-in for enabling an
    // optional LLM provider. Any OpenAI-compatible endpoint (OpenAI, xAI/Grok,
    // Together, Fireworks, ...) routes through this adapter. USESTEADY_USE_GROK
    // and USESTEADY_USE_OPENAI_COMPAT are preserved as back-compat aliases so
    // existing configurations keep working unchanged. No provider is "primary".
    return (process.env["USESTEADY_USE_LLM"] === "true" ||
        process.env["USESTEADY_USE_GROK"] === "true" ||
        process.env["USESTEADY_USE_OPENAI_COMPAT"] === "true");
}
// ─── System prompt ────────────────────────────────────────────────────────────
//
// Intentionally matches ClaudeApiAdapter.buildSystemPrompt() output.
// Both adapters must present the same constraints to their respective models.
function buildSystemPrompt(artifact) {
    const lines = [
        "You are a governed code editor operating under the UseSteady control framework.",
        "",
        "═══ AUTHORITY CONSTRAINTS (non-negotiable) ═══",
        "",
    ];
    if (artifact.allowedFiles.length > 0) {
        lines.push("ALLOWED FILES (you may ONLY edit or read these paths):", ...artifact.allowedFiles.map((f) => `  - ${f}`), "");
    }
    else {
        lines.push("ALLOWED FILES: No explicit restriction. Search within the workspace.", "");
    }
    if (artifact.prohibitedPatterns.length > 0) {
        lines.push("PROHIBITED PATTERNS (you must NEVER touch files matching these globs):", ...artifact.prohibitedPatterns.map((p) => `  - ${p}`), "");
    }
    lines.push("ALLOWED TOOLS:", ...artifact.allowedTools.map((t) => `  - ${t}`), "", "NETWORK ACCESS: DENIED. You must not attempt any external HTTP requests.", "FILESYSTEM MODE: scoped_only. All file operations must stay within allowedFiles.", "", `OCD CLEARANCE: ${artifact.ocdClearance === "clear"
        ? "clear — no detected conflicts."
        : "conflict_accepted — human has reviewed and accepted the conflict."}`, "", "═══ SCOPE CLARIFICATION PROTOCOL ═══", "", "If the target file is ambiguous or not in allowedFiles, you MUST call", "request_scope_clarification with real file path candidates.", "Do NOT guess file paths. Do NOT widen scope beyond allowedFiles.", "", "═══ TASK ═══", "", `Execution domain: ${artifact.executionDomain}`);
    return lines.join("\n");
}
// ─── User message ─────────────────────────────────────────────────────────────
function buildUserMessage(taskSpec) {
    const lines = [
        `Task category: ${taskSpec.category}`,
        `Task summary: ${taskSpec.summary}`,
    ];
    if (taskSpec.parsedChange) {
        const pc = taskSpec.parsedChange;
        lines.push("");
        lines.push("Structured edit:");
        if (pc.filePath)
            lines.push(`  File: ${pc.filePath}`);
        if (pc.oldValue)
            lines.push(`  Replace: "${pc.oldValue}"`);
        if (pc.newValue)
            lines.push(`  With:    "${pc.newValue}"`);
    }
    lines.push("", "Complete the task using only the allowed tools and files. " +
        "If the scope is ambiguous, call request_scope_clarification.");
    return lines.join("\n");
}
// ─── Tool resolution (OpenAI function-calling format) ────────────────────────
const SCOPE_CLARIFICATION_TOOL = {
    type: "function",
    function: {
        name: "request_scope_clarification",
        description: "Call this when you cannot proceed without human clarification about which file(s) " +
            "or scope to apply the change to. Provide the candidates you found, or an empty array " +
            "if no matching candidates exist.",
        parameters: {
            type: "object",
            properties: {
                questionKind: {
                    type: "string",
                    enum: [
                        "need_file_path",
                        "need_scope_selection",
                        "need_tool_permission",
                        "ambiguous_old_value",
                    ],
                    description: "The kind of scope ambiguity encountered.",
                },
                candidates: {
                    type: "array",
                    items: { type: "string" },
                    description: "List of candidate file paths or values for human selection.",
                },
                explanation: {
                    type: "string",
                    description: "Human-readable description of the ambiguity.",
                },
            },
            required: ["questionKind", "candidates", "explanation"],
        },
    },
};
const KNOWN_TOOLS = {
    str_replace_editor: {
        type: "function",
        function: {
            name: "str_replace_editor",
            description: "View and edit file contents using exact string replacement. " +
                "Only operates on files within the approved scope.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        enum: ["view", "str_replace", "create", "insert"],
                        description: "The editing command to execute.",
                    },
                    path: {
                        type: "string",
                        description: "File path relative to workspace root (must be within allowedFiles).",
                    },
                    old_str: {
                        type: "string",
                        description: "The exact string to search for (required for str_replace).",
                    },
                    new_str: {
                        type: "string",
                        description: "The replacement string (required for str_replace and insert).",
                    },
                    insert_line: {
                        type: "number",
                        description: "Line number to insert after (required for insert).",
                    },
                },
                required: ["command", "path"],
            },
        },
    },
    read_file: {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the contents of a file. Only reads files within the approved scope.",
            parameters: {
                type: "object",
                properties: {
                    path: {
                        type: "string",
                        description: "File path relative to workspace root.",
                    },
                    start_line: {
                        type: "number",
                        description: "First line to return (1-based, optional).",
                    },
                    end_line: {
                        type: "number",
                        description: "Last line to return (1-based, optional).",
                    },
                },
                required: ["path"],
            },
        },
    },
    list_files: {
        type: "function",
        function: {
            name: "list_files",
            description: "List files matching a glob pattern within the workspace. " +
                "Results are constrained to allowedFiles scope.",
            parameters: {
                type: "object",
                properties: {
                    pattern: {
                        type: "string",
                        description: "Glob pattern to match (e.g. 'src/**/*.ts').",
                    },
                },
                required: ["pattern"],
            },
        },
    },
    run_tests: {
        type: "function",
        function: {
            name: "run_tests",
            description: "Run the test suite for a specific file or pattern. " +
                "Results are returned as structured pass/fail output.",
            parameters: {
                type: "object",
                properties: {
                    pattern: {
                        type: "string",
                        description: "Test file path or glob pattern.",
                    },
                },
                required: ["pattern"],
            },
        },
    },
};
function resolveTools(allowedTools) {
    const tools = [SCOPE_CLARIFICATION_TOOL];
    for (const toolName of allowedTools) {
        const def = KNOWN_TOOLS[toolName];
        if (def !== undefined) {
            tools.push(def);
        }
    }
    return tools;
}
// ─── Response mapping ─────────────────────────────────────────────────────────
function mapCompletionResponse(completion, artifact) {
    const choice = completion.choices[0];
    if (choice === undefined) {
        return {
            kind: "refused_due_to_execution_error",
            code: "empty_response",
            message: "OpenAI-compatible API returned no choices.",
            messageOrigin: "adapter",
        };
    }
    const { finish_reason, message } = choice;
    // P3 Phase 1: capture the model's verbatim message content for preservation.
    // Never classified, never interpreted — evidence only. Omitted when absent.
    const modelText = typeof message.content === "string" && message.content.trim().length > 0
        ? message.content
        : undefined;
    // Tool call path
    if (finish_reason === "tool_calls" && message.tool_calls !== undefined) {
        const scopeQuestion = extractScopeQuestion(message.tool_calls, artifact);
        if (scopeQuestion !== null) {
            return { kind: "refused_due_to_scope", question: scopeQuestion };
        }
        // Model used a task tool (not scope clarification) — treat as accepted
        return { kind: "accepted", sessionId: completion.id, ...withModelText(modelText) };
    }
    // Normal completion
    if (finish_reason === "stop") {
        return { kind: "accepted", sessionId: completion.id, ...withModelText(modelText) };
    }
    // length: model hit max_tokens — session ran, treat as accepted (content may be truncated)
    if (finish_reason === "length") {
        return { kind: "accepted", sessionId: completion.id, ...withModelText(modelText) };
    }
    // content_filter or unknown
    return {
        kind: "refused_due_to_execution_error",
        code: "unexpected_finish_reason",
        message: `OpenAI-compatible API finished with unexpected reason: "${finish_reason}".`,
        messageOrigin: "adapter",
    };
}
/** Conditional-spread helper: omit modelText entirely when absent. */
function withModelText(modelText) {
    return modelText !== undefined ? { modelText } : {};
}
function extractScopeQuestion(toolCalls, artifact) {
    for (const call of toolCalls) {
        // Guard: only standard function tool calls carry a `.function` property
        if (call.type !== "function")
            continue;
        if (call.function.name !== "request_scope_clarification")
            continue;
        let input;
        try {
            input = JSON.parse(call.function.arguments);
        }
        catch {
            continue;
        }
        const questionKind = input["questionKind"];
        const rawCandidates = input["candidates"];
        const explanation = input["explanation"] ?? "Scope clarification needed.";
        if (!questionKind)
            continue;
        const candidates = normalizeCandidates(rawCandidates, artifact);
        return { questionKind, candidates, explanation };
    }
    return null;
}
function normalizeCandidates(rawCandidates, artifact) {
    if (!Array.isArray(rawCandidates))
        return [];
    const candidates = rawCandidates
        .filter((c) => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim());
    if (artifact.allowedFiles.length === 0 || candidates.length === 0) {
        return candidates;
    }
    const allowed = new Set(artifact.allowedFiles);
    const filtered = candidates.filter((c) => allowed.has(c));
    return filtered.length > 0 ? filtered : candidates;
}
// ─── Error mapping ────────────────────────────────────────────────────────────
function mapApiError(err) {
    // All messages below are synthesized by this adapter from error conditions —
    // they are never model-authored text (messageOrigin: "adapter").
    if (err instanceof OpenAI.APIConnectionError || err instanceof OpenAI.APIConnectionTimeoutError) {
        return {
            kind: "refused_due_to_execution_error",
            code: "session_interrupted",
            message: "OpenAI-compatible session interrupted due to a connection error. Non-resumable.",
            messageOrigin: "adapter",
        };
    }
    if (err instanceof OpenAI.RateLimitError) {
        return {
            kind: "refused_due_to_execution_error",
            code: "rate_limited",
            message: "OpenAI-compatible API rate limit exceeded. Retry after a brief delay.",
            messageOrigin: "adapter",
        };
    }
    if (err instanceof OpenAI.AuthenticationError) {
        return {
            kind: "refused_due_to_execution_error",
            code: "auth_error",
            message: "OpenAI-compatible API authentication failed. Check the API key.",
            messageOrigin: "adapter",
        };
    }
    if (err instanceof OpenAI.APIError) {
        const status = err.status ?? 0;
        const code = status >= 500 ? "api_server_error" : "api_client_error";
        return {
            kind: "refused_due_to_execution_error",
            code,
            message: `OpenAI-compatible API returned HTTP ${status}: ${safeMessage(err)}.`,
            messageOrigin: "adapter",
        };
    }
    return {
        kind: "refused_due_to_execution_error",
        code: "api_error",
        message: `OpenAI-compatible API call failed: ${safeMessage(err)}.`,
        messageOrigin: "adapter",
    };
}
function safeMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
//# sourceMappingURL=openai-compatible-adapter.js.map