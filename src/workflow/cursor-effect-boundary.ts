import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
import type {
  CursorDeliveryRequest,
  CursorResponse,
  CursorRefusedDueToExecutionError,
  CursorRefusedDueToScope,
} from "../cursor/types.js";
import {
  EFFECT_REFUSAL_CODES,
  type EffectDecision,
  type EffectRefusalCode,
} from "./effect-decision.js";

const EFFECT_REFUSAL_SET = new Set<string>(EFFECT_REFUSAL_CODES);
const CURSOR_NONSEMANTIC_ERROR_CODES = new Set(["parse_error", "delivery_timeout"]);

type CursorAccepted = Extract<CursorResponse, { kind: "accepted" }>;

type CursorEffectDecisionOutcome = {
  readonly kind: "decision";
  readonly decision: EffectDecision;
  readonly cursorResponse: CursorAccepted | CursorRefusedDueToExecutionError;
};

type CursorScopeOutcome = {
  readonly kind: "scope";
  readonly cursorResponse: CursorRefusedDueToScope;
};

type CursorNonSemanticFailureOutcome = {
  readonly kind: "non_semantic_failure";
  readonly detail: string;
  readonly rawResponse: unknown;
  readonly safeResponse: CursorRefusedDueToExecutionError;
};

export type CursorEffectBoundaryOutcome =
  | CursorEffectDecisionOutcome
  | CursorScopeOutcome
  | CursorNonSemanticFailureOutcome;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidResponseEnvelope(response: Record<string, unknown>): boolean {
  return typeof response.deliveryId === "string" &&
    typeof response.artifactId === "string" &&
    typeof response.receivedAt === "number" &&
    Number.isFinite(response.receivedAt);
}

function safeFailure(
  request: CursorDeliveryRequest,
  detail: string,
): CursorRefusedDueToExecutionError {
  return {
    kind: "refused_due_to_execution_error",
    deliveryId: request.deliveryId,
    artifactId: request.artifact.id,
    receivedAt: Date.now(),
    errorCode: "parse_error",
    detail,
  };
}

function nonSemantic(
  request: CursorDeliveryRequest,
  rawResponse: unknown,
  detail: string,
  safeResponse?: CursorRefusedDueToExecutionError,
): CursorNonSemanticFailureOutcome {
  return {
    kind: "non_semantic_failure",
    detail,
    rawResponse,
    safeResponse: safeResponse ?? safeFailure(request, detail),
  };
}

function isScopeQuestion(value: unknown): value is CursorRefusedDueToScope["scopeQuestion"] {
  if (!isRecord(value)) return false;
  if (
    value.questionKind !== "need_file_path" &&
    value.questionKind !== "need_scope_selection" &&
    value.questionKind !== "ambiguous_old_value"
  ) return false;
  if (!Array.isArray(value.candidates) || !value.candidates.every(v => typeof v === "string")) return false;
  return typeof value.searchedFor === "string" && typeof value.explanation === "string";
}

/**
 * Validate and classify one Cursor runtime response at the semantic effect
 * boundary. The established Cursor contract treats response delivery/artifact
 * ids as transport correlation supplied by the adapter; this boundary validates
 * their shape but does not introduce a new equality invariant.
 */
export function classifyCursorEffectResponse(
  rawResponse: unknown,
  request: CursorDeliveryRequest,
): CursorEffectBoundaryOutcome {
  if (!isRecord(rawResponse) || typeof rawResponse.kind !== "string") {
    return nonSemantic(request, rawResponse, "Cursor returned a malformed response; execution refused closed.");
  }

  if (rawResponse.kind === "accepted") {
    if (!hasValidResponseEnvelope(rawResponse)) {
      return nonSemantic(request, rawResponse, "Cursor accepted response was malformed; execution refused closed.");
    }
    const response = rawResponse as unknown as CursorAccepted;
    return {
      kind: "decision",
      decision: { kind: "accepted" },
      cursorResponse: response,
    };
  }

  if (rawResponse.kind === "refused_due_to_scope") {
    if (!hasValidResponseEnvelope(rawResponse) || !isScopeQuestion(rawResponse.scopeQuestion)) {
      return nonSemantic(request, rawResponse, "Cursor scope response was malformed; execution refused closed.");
    }
    return {
      kind: "scope",
      cursorResponse: rawResponse as unknown as CursorRefusedDueToScope,
    };
  }

  if (rawResponse.kind === "refused_due_to_execution_error") {
    if (
      !hasValidResponseEnvelope(rawResponse) ||
      typeof rawResponse.errorCode !== "string" ||
      typeof rawResponse.detail !== "string"
    ) {
      return nonSemantic(request, rawResponse, "Cursor execution-error response was malformed; execution refused closed.");
    }

    const response = rawResponse as unknown as CursorRefusedDueToExecutionError;
    if (EFFECT_REFUSAL_SET.has(rawResponse.errorCode)) {
      return {
        kind: "decision",
        decision: {
          kind: "refused",
          code: rawResponse.errorCode as EffectRefusalCode,
          detail: rawResponse.detail,
        },
        cursorResponse: response,
      };
    }

    if (CURSOR_NONSEMANTIC_ERROR_CODES.has(rawResponse.errorCode)) {
      return nonSemantic(request, rawResponse, rawResponse.detail, response);
    }

    return nonSemantic(
      request,
      rawResponse,
      `Cursor returned unknown execution error code "${rawResponse.errorCode}"; execution refused closed.`,
    );
  }

  return nonSemantic(
    request,
    rawResponse,
    `Cursor returned unknown response kind "${rawResponse.kind}"; execution refused closed.`,
  );
}

export async function executeCursorEffect(
  plugin: CursorEditorPlugin,
  request: CursorDeliveryRequest,
): Promise<CursorEffectBoundaryOutcome> {
  return classifyCursorEffectResponse(await plugin.receive(request), request);
}
