import type { ClaudeAgentPlugin } from "../claude/delivery-gate.js";
import type {
  ClaudeDeliveryRequest,
  ClaudeDeliveryResponse,
  ClaudeRefusedDueToExecutionError,
  ClaudeRefusedDueToScope,
  ClaudeAdvisoryPositions,
} from "../claude/types.js";
import {
  EFFECT_REFUSAL_CODES,
  type EffectDecision,
  type EffectRefusalCode,
} from "./effect-decision.js";

const EFFECT_REFUSAL_SET = new Set<string>(EFFECT_REFUSAL_CODES);

type ClaudeAccepted = Extract<ClaudeDeliveryResponse, { kind: "accepted" }>;

type ClaudeEffectBoundaryOutcome =
  | {
      readonly kind: "decision";
      readonly decision: EffectDecision;
      readonly claudeResponse: ClaudeAccepted | ClaudeRefusedDueToExecutionError;
    }
  | {
      readonly kind: "scope";
      readonly claudeResponse: ClaudeRefusedDueToScope;
    }
  | {
      readonly kind: "advisory";
      readonly claudeResponse: ClaudeAdvisoryPositions;
    }
  | {
      readonly kind: "non_semantic_failure";
      readonly detail: string;
      readonly rawResponse: unknown;
      readonly safeResponse: ClaudeRefusedDueToExecutionError;
    };

export type ClaudeEffectDecisionOutcome = ClaudeEffectBoundaryOutcome;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeFailure(detail: string): ClaudeRefusedDueToExecutionError {
  return {
    kind: "refused_due_to_execution_error",
    code: "invalid_runtime_response",
    message: detail,
    messageOrigin: "adapter",
  };
}

function nonSemantic(
  rawResponse: unknown,
  detail: string,
  safeResponse?: ClaudeRefusedDueToExecutionError,
): ClaudeEffectBoundaryOutcome {
  return {
    kind: "non_semantic_failure",
    detail,
    rawResponse,
    safeResponse: safeResponse ?? safeFailure(detail),
  };
}

function isScopeQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    value.questionKind !== "need_file_path" &&
    value.questionKind !== "need_scope_selection" &&
    value.questionKind !== "need_tool_permission" &&
    value.questionKind !== "ambiguous_old_value"
  ) return false;
  return Array.isArray(value.candidates) &&
    value.candidates.every(candidate => typeof candidate === "string") &&
    typeof value.explanation === "string";
}

function isAdvisoryPositions(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(position =>
    isRecord(position) &&
    (position.kind === "warning" ||
      position.kind === "recommend_against" ||
      position.kind === "uncertainty" ||
      position.kind === "alternative") &&
    typeof position.explanation === "string" &&
    typeof position.artifactId === "string" &&
    typeof position.runtime === "string" &&
    typeof position.model === "string"
  );
}

/**
 * Classify a Claude response without allowing model/provider/tool diagnostics to
 * manufacture governed refusal semantics. Scope and advisory responses remain
 * their established control/evidence paths.
 */
export function classifyClaudeEffectResponse(rawResponse: unknown): ClaudeEffectBoundaryOutcome {
  if (!isRecord(rawResponse) || typeof rawResponse.kind !== "string") {
    return nonSemantic(rawResponse, "Claude returned a malformed response; execution refused closed.");
  }

  if (rawResponse.kind === "accepted") {
    if (
      typeof rawResponse.sessionId !== "string" || rawResponse.sessionId.length === 0 ||
      (rawResponse.modelText !== undefined && typeof rawResponse.modelText !== "string")
    ) {
      return nonSemantic(rawResponse, "Claude accepted response was malformed; execution refused closed.");
    }
    return {
      kind: "decision",
      decision: { kind: "accepted" },
      claudeResponse: rawResponse as unknown as ClaudeAccepted,
    };
  }

  if (rawResponse.kind === "refused_due_to_scope") {
    if (!isScopeQuestion(rawResponse.question)) {
      return nonSemantic(rawResponse, "Claude scope response was malformed; execution refused closed.");
    }
    return {
      kind: "scope",
      claudeResponse: rawResponse as unknown as ClaudeRefusedDueToScope,
    };
  }

  if (rawResponse.kind === "advisory") {
    if (!isAdvisoryPositions(rawResponse.positions)) {
      return nonSemantic(rawResponse, "Claude advisory response was malformed; execution refused closed.");
    }
    return {
      kind: "advisory",
      claudeResponse: rawResponse as unknown as ClaudeAdvisoryPositions,
    };
  }

  if (rawResponse.kind === "refused_due_to_execution_error") {
    if (
      typeof rawResponse.code !== "string" ||
      typeof rawResponse.message !== "string" ||
      (rawResponse.messageOrigin !== undefined &&
        rawResponse.messageOrigin !== "model" &&
        rawResponse.messageOrigin !== "adapter")
    ) {
      return nonSemantic(rawResponse, "Claude execution-error response was malformed; execution refused closed.");
    }

    const response = rawResponse as unknown as ClaudeRefusedDueToExecutionError;
    if (EFFECT_REFUSAL_SET.has(rawResponse.code)) {
      return {
        kind: "decision",
        decision: {
          kind: "refused",
          code: rawResponse.code as EffectRefusalCode,
          detail: rawResponse.message,
          ...(rawResponse.messageOrigin === "model"
            ? { rawDiagnostic: rawResponse.message }
            : {}),
        },
        claudeResponse: response,
      };
    }

    return nonSemantic(rawResponse, rawResponse.message, response);
  }

  return nonSemantic(
    rawResponse,
    `Claude returned unknown response kind "${rawResponse.kind}"; execution refused closed.`,
  );
}

export async function executeClaudeEffect(
  plugin: ClaudeAgentPlugin,
  request: ClaudeDeliveryRequest,
): Promise<ClaudeEffectBoundaryOutcome> {
  return classifyClaudeEffectResponse(await plugin.receive(request));
}
