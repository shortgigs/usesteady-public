/**
 * Handler intent types (descriptive only — no mutation).
 * @see docs/product/executor-handler-execution-contract-v1.md
 */

import type { ExecutionRecord } from "../runtime/types.js";

export type HandlerIntentLineageKind = "intent_derived" | "intent_blocked";

export type HandlerIntentLineageEntry = {
  readonly at: string;
  readonly kind: HandlerIntentLineageKind;
  readonly note?: string;
};

export type HandlerIntentRecord = {
  readonly handler_intent_id: string;
  readonly execution_id: string;
  readonly capability_id: string;
  readonly handler_kind: "descriptive";
  readonly intent_summary: string;
  readonly target_scope: readonly string[];
  readonly risk_notes: readonly string[];
  readonly lineage: readonly HandlerIntentLineageEntry[];
};

export type InvokeHandlerIntentInput = {
  readonly execution: ExecutionRecord;
  readonly capability_handler_id: string;
};

export type HandlerIntentRejection = {
  readonly rejection_cause: string;
  readonly explain: string;
};

export class HandlerIntentRejectedError extends Error implements HandlerIntentRejection {
  readonly rejection_cause: string;
  readonly explain: string;

  constructor(rejection_cause: string, explain: string) {
    super(explain);
    this.name = "HandlerIntentRejectedError";
    this.rejection_cause = rejection_cause;
    this.explain = explain;
  }
}
