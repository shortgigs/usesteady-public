/**
 * Claude API Adapter — Phase 8C.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   The real ClaudeAgentPlugin implementation. Translates a ClaudeDeliveryRequest
 *   into an Anthropic API call and maps the response back to ClaudeDeliveryResponse.
 *
 *   This is the transport-specific adapter the delivery gate uses when operating
 *   against the real Anthropic API. It replaces ClaudeStubAdapter in production.
 *
 * ── What this adapter does ────────────────────────────────────────────────────
 *
 *   1. Builds a system prompt from artifact constraints (allowedFiles,
 *      prohibitedPatterns, allowedTools, executionDomain).
 *   2. Builds the user message from taskSpec ONLY — never from raw user input.
 *   3. Maps allowedTools names to Anthropic tool schemas (known-tool registry).
 *   4. Always includes `request_scope_clarification` as a gate protocol tool.
 *   5. Calls the Anthropic messages API.
 *   6. Maps the API response to ClaudeDeliveryResponse:
 *      - stop_reason "end_turn"    → accepted  (sessionId = API response id)
 *      - tool_use + scope tool     → refused_due_to_scope with candidates
 *      - tool_use + other          → accepted (Claude used a task tool; session live)
 *      - API error / timeout       → refused_due_to_execution_error
 *      - Network interruption      → refused_due_to_execution_error (code: session_interrupted)
 *
 * ── Model Insertion Policy (Section 9.5) ─────────────────────────────────────
 *
 *   This module calls the Anthropic API. A deterministic bypass path is required.
 *   Bypass is provided by passing `bypass: ClaudeAgentPlugin` in the config and
 *   setting the environment variable USESTEADY_USE_CLAUDE to any value other than "true".
 *   In CI, callers use ClaudeStubAdapter as the bypass.
 *
 * ── Phase A locked truths (enforced here) ────────────────────────────────────
 *
 *   A1 — We never re-classify executionDomain. We use artifact.executionDomain as-is.
 *   A2 — networkAccess "deny" is enforced at the system prompt level: no HTTP tools.
 *   A3 — On interruption/timeout, we return session_interrupted (non-resumable).
 *   A4 — We never call back into Intake. We use only artifact.taskSpec for prompts.
 *
 * ── Candidate generation (Phase 8C) ──────────────────────────────────────────
 *
 *   When Claude calls `request_scope_clarification`, it provides candidates from
 *   within allowedFiles (or searches within the workspace for real candidate paths).
 *   This is the Phase 8C upgrade over the stub, which used pre-configured candidates.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeAgentPlugin }     from "../delivery-gate.js";
import type {
  ClaudeDeliveryRequest,
  ClaudeDeliveryResponse,
  ClaudeScopeQuestion,
  ClaudeAgentHandoffArtifact,
  ClaudeTaskSpec,
  ModelAdvisoryKind,
  ModelAdvisoryPosition,
  RetiredAdvisoryContext,
} from "../types.js";
import { MODEL_ADVISORY_KINDS }       from "../types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Configuration for ClaudeApiAdapter.
 *
 *   apiKey         — Anthropic API key. Required.
 *   model          — Anthropic model ID. Defaults to "claude-opus-4-5".
 *   maxTokens      — Max tokens for the response. Defaults to 4096.
 *   timeoutMs      — API call timeout. Defaults to 30 000 ms.
 *   bypass         — Deterministic fallback plugin (model insertion policy).
 *                    Used when USESTEADY_USE_CLAUDE !== "true".
 *   _anthropic     — Injectable Anthropic client (for testing only).
 *                    When provided, the real Anthropic client is not created.
 */
export type ClaudeApiAdapterConfig = {
  readonly apiKey:       string;
  readonly model?:       string;
  readonly maxTokens?:   number;
  readonly timeoutMs?:   number;
  /** Deterministic fallback for CI and model-disabled environments. */
  readonly bypass?:      ClaudeAgentPlugin;
  /** Injectable Anthropic client for unit tests. Not for production use. */
  readonly _anthropic?:  Pick<Anthropic, "messages">;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL      = "claude-opus-4-5";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * ClaudeApiAdapter — real ClaudeAgentPlugin backed by the Anthropic API.
 *
 * Production usage:
 *   const adapter = new ClaudeApiAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! });
 *   const gate    = new ClaudeDeliveryGate(adapter, storeDir);
 *
 * CI usage (model disabled):
 *   const adapter = new ClaudeApiAdapter({
 *     apiKey: "ci-key",
 *     bypass: ClaudeStubAdapter.accepted("ci-session"),
 *   });
 *   // USESTEADY_USE_CLAUDE is unset → bypass is used automatically
 */
export class ClaudeApiAdapter implements ClaudeAgentPlugin {
  private readonly client:    Pick<Anthropic, "messages">;
  private readonly model:     string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly bypass:    ClaudeAgentPlugin | undefined;

  constructor(config: ClaudeApiAdapterConfig) {
    this.client    = config._anthropic ?? new Anthropic({
      apiKey:  config.apiKey,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.model     = config.model      ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens  ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = config.timeoutMs  ?? DEFAULT_TIMEOUT_MS;
    this.bypass    = config.bypass;
  }

  async receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse> {
    // Model Insertion Policy: use bypass when Claude is not enabled
    if (!isClaudeEnabled() && this.bypass !== undefined) {
      return this.bypass.receive(request);
    }

    const { artifact } = request;

    const systemPrompt = buildSystemPrompt(artifact);
    const userMessage  = buildUserMessage(
      artifact.taskSpec,
      request.priorAdvisories,
      request.retiredAdvisories,
    );
    const tools        = resolveTools(artifact.allowedTools);

    try {
      const response = await this.client.messages.create({
        model:      this.model,
        max_tokens: this.maxTokens,
        system:     systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        tools,
      });

      return mapApiResponse(response, artifact, this.model);

    } catch (err) {
      return mapApiError(err);
    }
  }

  /** Returns true if the adapter is configured to make real API calls. */
  get isLive(): boolean {
    return isClaudeEnabled() || this.bypass === undefined;
  }
}

// ─── Model insertion policy ───────────────────────────────────────────────────

function isClaudeEnabled(): boolean {
  return process.env["USESTEADY_USE_CLAUDE"] === "true";
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(artifact: ClaudeAgentHandoffArtifact): string {
  const lines: string[] = [
    "You are a governed code editor operating under the UseSteady control framework.",
    "",
    "═══ AUTHORITY CONSTRAINTS (non-negotiable) ═══",
    "",
  ];

  // File scope
  if (artifact.allowedFiles.length > 0) {
    lines.push(
      "ALLOWED FILES (you may ONLY edit or read these paths):",
      ...artifact.allowedFiles.map((f) => `  - ${f}`),
      "",
    );
  } else {
    lines.push(
      "ALLOWED FILES: No explicit restriction. Search within the workspace.",
      "",
    );
  }

  // Prohibited patterns
  if (artifact.prohibitedPatterns.length > 0) {
    lines.push(
      "PROHIBITED PATTERNS (you must NEVER touch files matching these globs):",
      ...artifact.prohibitedPatterns.map((p) => `  - ${p}`),
      "",
    );
  }

  // Tool constraints
  lines.push(
    "ALLOWED TOOLS:",
    ...artifact.allowedTools.map((t) => `  - ${t}`),
    "",
    "NETWORK ACCESS: DENIED. You must not attempt any external HTTP requests.",
    "FILESYSTEM MODE: scoped_only. All file operations must stay within allowedFiles.",
    "",
  );

  // OCD clearance status
  lines.push(
    `OCD CLEARANCE: ${artifact.ocdClearance === "clear"
      ? "clear — no detected conflicts."
      : "conflict_accepted — human has reviewed and accepted the conflict."}`,
    "",
    "═══ SCOPE CLARIFICATION PROTOCOL ═══",
    "",
    "If the target file is ambiguous or not in allowedFiles, you MUST call",
    "request_scope_clarification with real file path candidates.",
    "Do NOT guess file paths. Do NOT widen scope beyond allowedFiles.",
    "",
    "═══ MODEL ADVISORY PROTOCOL ═══",
    "",
    "If you CAN technically perform the task but have a material concern about it",
    "(a risk, a recommendation against, significant uncertainty, or a better",
    "alternative), you MUST call model_advisory_position INSTEAD of executing.",
    "An advisory pauses the action for human review; it does not decide anything.",
    "Call it at most once per response (multiple positions in one call are not",
    "supported — choose the single most important position).",
    "If you have no material concern, proceed with the task normally.",
    "",
    "═══ TASK ═══",
  );

  lines.push(
    "",
    `Execution domain: ${artifact.executionDomain}`,
  );

  return lines.join("\n");
}

// ─── User message ─────────────────────────────────────────────────────────────

function buildUserMessage(
  taskSpec:        ClaudeTaskSpec,
  priorAdvisories?: readonly ModelAdvisoryPosition[],
  retiredAdvisories?: readonly RetiredAdvisoryContext[],
): string {
  const lines: string[] = [
    `Task category: ${taskSpec.category}`,
    `Task summary: ${taskSpec.summary}`,
  ];

  if (taskSpec.parsedChange) {
    const pc = taskSpec.parsedChange;
    lines.push("");
    lines.push("Structured edit:");
    if (pc.filePath) lines.push(`  File: ${pc.filePath}`);
    if (pc.oldValue) lines.push(`  Replace: "${pc.oldValue}"`);
    if (pc.newValue) lines.push(`  With:    "${pc.newValue}"`);
  }

  // P3 Phase 2: when a human has explicitly superseded a prior advisory on this
  // exact artifact, the model is informed on re-delivery. Informational only.
  if (priorAdvisories !== undefined && priorAdvisories.length > 0) {
    lines.push("");
    lines.push(
      "Note: you previously recorded an advisory position on this exact action,",
      "and the authorized human reviewer explicitly chose to proceed despite it:",
    );
    for (const position of priorAdvisories) {
      lines.push(`  - [${position.kind}] ${position.explanation}`);
    }
    lines.push("Proceed with the task unless you have a NEW material concern.");
  }

  // P5 V1: retired positions are a separate, non-standing context. The model
  // is informed that these identities were retired on named evidence.
  if (retiredAdvisories !== undefined && retiredAdvisories.length > 0) {
    lines.push("");
    lines.push(
      "Note: the following model position(s) were retired by an authorized human",
      "on named resolving evidence. They are not standing. Do not reassert them",
      "on the same recorded grounds:",
    );
    for (const retired of retiredAdvisories) {
      const ev = retired.resolvingEvidenceIds.join(", ");
      lines.push(
        `  - [${retired.position.kind}] id=${retired.modelPositionId} evidence=${ev}`,
        `    ${retired.position.explanation}`,
      );
    }
  }

  lines.push("");
  lines.push(
    "Complete the task using only the allowed tools and files. " +
    "If the scope is ambiguous, call request_scope_clarification. " +
    "If you have a material concern about the action, call model_advisory_position.",
  );

  return lines.join("\n");
}

// ─── Tool resolution ──────────────────────────────────────────────────────────

/**
 * The gate protocol tool — always included regardless of allowedTools.
 * Claude calls this when scope clarification is needed before it can proceed.
 */
const SCOPE_CLARIFICATION_TOOL: Anthropic.Tool = {
  name: "request_scope_clarification",
  description:
    "Call this when you cannot proceed without human clarification about which file(s) " +
    "or scope to apply the change to. Provide the candidates you found, or an empty array " +
    "if no matching candidates exist.",
  input_schema: {
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
        type:        "string",
        description: "Human-readable description of the ambiguity.",
      },
    },
    required: ["questionKind", "candidates", "explanation"],
  } as Anthropic.Tool["input_schema"],
};

/**
 * The model advisory tool — always included regardless of allowedTools
 * (P3 Phase 2). Claude calls this when it CAN technically perform the task
 * but holds a material position about it (warning / recommend_against /
 * uncertainty / alternative). Emission through this structured contract is
 * the ONLY way a model position becomes an actionable advisory; free-text
 * prose is preserved as evidence but never classified as an advisory.
 */
const MODEL_ADVISORY_TOOL: Anthropic.Tool = {
  name: "model_advisory_position",
  description:
    "Call this when you can technically perform the task but have a material position " +
    "about it that a human should review BEFORE the action runs: a warning, a " +
    "recommendation against, significant uncertainty, or a better alternative. " +
    "Calling this pauses the action for human review instead of executing it. " +
    "Do NOT call this for scope ambiguity (use request_scope_clarification) and do " +
    "NOT call it when you have no material concern.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [
          "warning",
          "recommend_against",
          "uncertainty",
          "alternative",
        ],
        description: "The kind of position you are recording.",
      },
      explanation: {
        type:        "string",
        description: "Your position, in your own words, addressed to the human reviewer.",
      },
    },
    required: ["kind", "explanation"],
  } as Anthropic.Tool["input_schema"],
};

/**
 * Known V1 tool registry.
 *
 * Maps tool names (as they appear in allowedTools) to Anthropic tool schemas.
 * Only tools in this registry may be used via the Claude seam.
 * Network-enabled tools are intentionally excluded (A2: networkAccess deny).
 */
const KNOWN_TOOLS: Record<string, Anthropic.Tool> = {
  str_replace_editor: {
    name: "str_replace_editor",
    description:
      "View and edit file contents using exact string replacement. " +
      "Only operates on files within the approved scope.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["view", "str_replace", "create", "insert"],
          description: "The editing command to execute.",
        },
        path: {
          type:        "string",
          description: "File path relative to workspace root (must be within allowedFiles).",
        },
        old_str: {
          type:        "string",
          description: "The exact string to search for (required for str_replace).",
        },
        new_str: {
          type:        "string",
          description: "The replacement string (required for str_replace and insert).",
        },
        insert_line: {
          type:        "number",
          description: "Line number to insert after (required for insert).",
        },
      },
      required: ["command", "path"],
    } as Anthropic.Tool["input_schema"],
  },

  read_file: {
    name: "read_file",
    description:
      "Read the contents of a file. Only reads files within the approved scope.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type:        "string",
          description: "File path relative to workspace root.",
        },
        start_line: {
          type:        "number",
          description: "First line to return (1-based, optional).",
        },
        end_line: {
          type:        "number",
          description: "Last line to return (1-based, optional).",
        },
      },
      required: ["path"],
    } as Anthropic.Tool["input_schema"],
  },

  list_files: {
    name: "list_files",
    description:
      "List files matching a glob pattern within the workspace. " +
      "Results are constrained to allowedFiles scope.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type:        "string",
          description: "Glob pattern to match (e.g. 'src/**/*.ts').",
        },
      },
      required: ["pattern"],
    } as Anthropic.Tool["input_schema"],
  },

  run_tests: {
    name: "run_tests",
    description:
      "Run the test suite for a specific file or pattern. " +
      "Results are returned as structured pass/fail output.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type:        "string",
          description: "Test file path or glob pattern.",
        },
      },
      required: ["pattern"],
    } as Anthropic.Tool["input_schema"],
  },
};

function resolveTools(allowedTools: readonly string[]): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [SCOPE_CLARIFICATION_TOOL, MODEL_ADVISORY_TOOL];
  for (const toolName of allowedTools) {
    const def = KNOWN_TOOLS[toolName];
    if (def !== undefined) {
      tools.push(def);
    }
  }
  return tools;
}

// ─── Response mapping ─────────────────────────────────────────────────────────

function mapApiResponse(
  response: Anthropic.Message,
  artifact: ClaudeAgentHandoffArtifact,
  model:    string,
): ClaudeDeliveryResponse {
  // P3 Phase 1: capture the model's verbatim text content for preservation.
  // Never classified, never interpreted — evidence only.
  const modelText = extractModelText(response);

  // Scope clarification: Claude called request_scope_clarification
  if (response.stop_reason === "tool_use") {
    const scopeQuestion = extractScopeQuestion(response, artifact);
    if (scopeQuestion !== null) {
      return { kind: "refused_due_to_scope", question: scopeQuestion };
    }

    // P3 Phase 2: structured model advisory. An advisory response NEVER counts
    // as acceptance — when an advisory tool call is present (even alongside a
    // task tool call), the delivery parks for a human supersession decision
    // instead of proceeding.
    const advisory = extractAdvisoryPositions(response, artifact, model);
    if (advisory.sawAdvisoryCall) {
      if (advisory.positions.length > 0) {
        return { kind: "advisory", positions: advisory.positions };
      }
      // The model invoked the advisory contract but every position was
      // malformed (missing/invalid kind or explanation). Fail closed.
      return {
        kind:          "refused_due_to_execution_error",
        code:          "malformed_advisory",
        message:       "Claude called model_advisory_position but no position carried a valid kind and explanation.",
        messageOrigin: "adapter",
      };
    }

    // Claude used a task tool (not scope clarification) — session is live
    return { kind: "accepted", sessionId: response.id, ...withModelText(modelText) };
  }

  // Normal completion
  if (response.stop_reason === "end_turn") {
    return { kind: "accepted", sessionId: response.id, ...withModelText(modelText) };
  }

  // max_tokens reached: not a clean completion, but not a refusal either
  // Treat as accepted — the session ran; content may be truncated
  if (response.stop_reason === "max_tokens") {
    return { kind: "accepted", sessionId: response.id, ...withModelText(modelText) };
  }

  // stop_sequence or unknown stop_reason: fail-closed
  return {
    kind:          "refused_due_to_execution_error",
    code:          "unexpected_stop_reason",
    message:       `Claude stopped with unexpected reason: "${response.stop_reason}".`,
    messageOrigin: "adapter",
  };
}

/**
 * Extract the model's verbatim text content from an API response.
 *
 * Concatenates all text blocks in emission order, joined by a single newline.
 * Returns undefined when the response contains no text blocks, so callers can
 * omit the field entirely (undefined-free payload rule).
 *
 * NO classification is performed here: a warning, a recommendation, and
 * ordinary commentary are all preserved identically as uninterpreted text.
 */
function extractModelText(response: Anthropic.Message): string | undefined {
  const texts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text" && block.text.trim().length > 0) {
      texts.push(block.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

/** Conditional-spread helper: omit modelText entirely when absent. */
function withModelText(modelText: string | undefined): { modelText?: string } {
  return modelText !== undefined ? { modelText } : {};
}

/**
 * Extract structured model advisory positions from an API response
 * (P3 Phase 2).
 *
 * Only `model_advisory_position` tool_use blocks produce positions — free-text
 * prose NEVER becomes an advisory (attack 7 in the P3 Phase 2 contract).
 * `artifactId`, `runtime`, and `model` are stamped by the adapter from the
 * invocation context; the model supplies only `kind` and `explanation`.
 * Malformed tool inputs (wrong kind, empty explanation) are dropped; callers
 * treat a response that saw an advisory call with zero valid positions as
 * fail-closed `malformed_advisory`.
 */
function extractAdvisoryPositions(
  response: Anthropic.Message,
  artifact: ClaudeAgentHandoffArtifact,
  model:    string,
): { sawAdvisoryCall: boolean; positions: readonly ModelAdvisoryPosition[] } {
  const kinds = new Set<string>(MODEL_ADVISORY_KINDS);
  const positions: ModelAdvisoryPosition[] = [];
  let sawAdvisoryCall = false;

  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    if (block.name !== "model_advisory_position") continue;
    sawAdvisoryCall = true;

    const input        = block.input as Record<string, unknown>;
    const kind         = input["kind"];
    const rawExplain   = input["explanation"];
    const explanation  = typeof rawExplain === "string" ? rawExplain.trim() : "";

    if (typeof kind !== "string" || !kinds.has(kind)) continue;
    if (explanation.length === 0) continue;

    positions.push({
      kind:       kind as ModelAdvisoryKind,
      explanation,
      artifactId: artifact.artifactId,
      runtime:    "claude",
      model,
    });
  }

  return { sawAdvisoryCall, positions };
}

function extractScopeQuestion(
  response: Anthropic.Message,
  artifact: ClaudeAgentHandoffArtifact,
): ClaudeScopeQuestion | null {
  for (const block of response.content) {
    if (block.type !== "tool_use") continue;
    if (block.name !== "request_scope_clarification") continue;

    const input = block.input as Record<string, unknown>;

    const questionKind = input["questionKind"] as ClaudeScopeQuestion["questionKind"] | undefined;
    const rawCandidates = input["candidates"];
    const explanation   = (input["explanation"] as string | undefined) ?? "Scope clarification needed.";

    if (!questionKind) continue;

    // Candidates: Claude-provided list, filtered to be within allowedFiles (or all if empty scope)
    const candidates = normalizeCandidates(rawCandidates, artifact);

    return { questionKind, candidates, explanation };
  }
  return null;
}

/**
 * Normalize scope candidates from Claude's tool call.
 *
 * If allowedFiles is non-empty, filters candidates to those matching the allowed set.
 * If no filtered candidates remain, returns all as-is (human will decide scope).
 */
function normalizeCandidates(
  rawCandidates: unknown,
  artifact:      ClaudeAgentHandoffArtifact,
): readonly string[] {
  if (!Array.isArray(rawCandidates)) return [];

  const candidates: string[] = rawCandidates
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim());

  if (artifact.allowedFiles.length === 0 || candidates.length === 0) {
    return candidates;
  }

  // Filter to paths within allowedFiles
  const allowed = new Set(artifact.allowedFiles);
  const filtered = candidates.filter((c) => allowed.has(c));
  return filtered.length > 0 ? filtered : candidates;
}

// ─── Error mapping ────────────────────────────────────────────────────────────

function mapApiError(err: unknown): ClaudeDeliveryResponse {
  // All messages below are synthesized by this adapter from error conditions —
  // they are never model-authored text (messageOrigin: "adapter").
  if (
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError
  ) {
    return {
      kind:          "refused_due_to_execution_error",
      code:          "session_interrupted",
      message:       "Claude session was interrupted due to a connection error. Non-resumable in V1.",
      messageOrigin: "adapter",
    };
  }

  if (err instanceof Anthropic.RateLimitError) {
    return {
      kind:          "refused_due_to_execution_error",
      code:          "rate_limited",
      message:       "Claude API rate limit exceeded. Retry after a brief delay.",
      messageOrigin: "adapter",
    };
  }

  if (err instanceof Anthropic.AuthenticationError) {
    return {
      kind:          "refused_due_to_execution_error",
      code:          "auth_error",
      message:       "Claude API authentication failed. Check the API key.",
      messageOrigin: "adapter",
    };
  }

  if (err instanceof Anthropic.APIError) {
    const status = (err as { status?: number }).status ?? 0;
    const code = status >= 500 ? "api_server_error" : "api_client_error";
    return {
      kind:          "refused_due_to_execution_error",
      code,
      message:       `Claude API returned HTTP ${status}: ${safeMessage(err)}.`,
      messageOrigin: "adapter",
    };
  }

  return {
    kind:          "refused_due_to_execution_error",
    code:          "api_error",
    message:       `Claude API call failed: ${safeMessage(err)}.`,
    messageOrigin: "adapter",
  };
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
