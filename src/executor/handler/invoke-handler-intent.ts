/**
 * Descriptive handler intent derivation — no mutation (INV-HAND-3).
 */

import {
  lookupHandlerById,
  lookupHandlersForCapability,
} from "./handler-bindings.js";
import { handlerIntentId } from "./handler-intent-id.js";
import type {
  HandlerIntentLineageEntry,
  HandlerIntentRecord,
  InvokeHandlerIntentInput,
} from "./types.js";
import { HandlerIntentRejectedError } from "./types.js";
import type { ExecutionRecord } from "../runtime/types.js";

function reject(rejection_cause: string, explain: string): never {
  throw new HandlerIntentRejectedError(rejection_cause, explain);
}

function isExecutionRecordIncomplete(execution: ExecutionRecord): boolean {
  if (execution.execution_id.trim().length === 0) return true;
  if (execution.capability_id.trim().length === 0) return true;
  if (execution.executor_eligibility_record_id.trim().length === 0) return true;
  if (execution.capability_eligibility_record_id.trim().length === 0) return true;
  if (execution.executed_at.trim().length === 0) return true;
  if (Number.isNaN(Date.parse(execution.executed_at))) return true;
  return false;
}

function buildLineage(executed_at: string, note: string): readonly HandlerIntentLineageEntry[] {
  return [
    {
      at:   executed_at,
      kind: "intent_derived",
      note,
    },
  ];
}

function validateBinding(
  execution: ExecutionRecord,
  capability_handler_id: string,
): {
  readonly intent_summary: string;
  readonly target_scope: readonly string[];
  readonly risk_notes: readonly string[];
} {
  const handlerId = capability_handler_id.trim();
  if (handlerId.length === 0) {
    reject("handler_unregistered", "Handler id is empty.");
  }

  const handlerEntry = lookupHandlerById(handlerId);
  if (!handlerEntry) {
    reject("handler_unregistered", `Handler ${handlerId} is not registered.`);
  }

  const capabilityHandlers = lookupHandlersForCapability(execution.capability_id);
  if (capabilityHandlers.length === 0) {
    reject(
      "capability_unbound",
      `No handler binding for capability ${execution.capability_id}.`,
    );
  }

  if (capabilityHandlers.length > 1) {
    reject(
      "handler_policy_fail_closed",
      `Ambiguous handler binding for capability ${execution.capability_id}.`,
    );
  }

  const expected = capabilityHandlers[0]!;
  if (expected.capability_handler_id !== handlerEntry.capability_handler_id) {
    reject(
      "handler_policy_fail_closed",
      `Handler ${handlerId} does not match capability ${execution.capability_id} binding.`,
    );
  }

  if (expected.capability_id !== execution.capability_id) {
    reject(
      "handler_policy_fail_closed",
      "Handler capability binding mismatch.",
    );
  }

  return {
    intent_summary: expected.intent_summary,
    target_scope:   expected.target_scope,
    risk_notes:     expected.risk_notes,
  };
}

export function invokeHandlerIntent(input: InvokeHandlerIntentInput): HandlerIntentRecord {
  const execution = input.execution;

  if (isExecutionRecordIncomplete(execution)) {
    reject("execution_record_incomplete", "Execution record is incomplete.");
  }

  const binding = validateBinding(execution, input.capability_handler_id);

  return {
    handler_intent_id: handlerIntentId({
      execution_id:          execution.execution_id,
      capability_id:         execution.capability_id,
      capability_handler_id: input.capability_handler_id.trim(),
      intent_summary:        binding.intent_summary,
    }),
    execution_id:  execution.execution_id,
    capability_id: execution.capability_id,
    handler_kind:  "descriptive",
    intent_summary: binding.intent_summary,
    target_scope:   binding.target_scope,
    risk_notes:     binding.risk_notes,
    lineage:        buildLineage(
      execution.executed_at,
      `descriptive intent derived from execution ${execution.execution_id}`,
    ),
  };
}
