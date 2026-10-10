/**
 * src/history/execution-instance-resolve.ts
 *
 * P-MED / F-02 — resolve operator `--run-id` / `--last` to one execution
 * instance. Zero authority. Read-only UCP projection.
 *
 * Ambiguity (one query matches two instance keys) fails closed.
 */

import { getByType } from "../ucp/persistence/index.js";
import type { UCPEnvelope, WorkflowRunPayload } from "../ucp/types.js";
import {
  compareExecutionOrder,
  executionInstanceKey,
  executionOrderKeyOf,
} from "../workflow/execution-instance.js";

const WORKFLOW_RUN_TYPE = "ucp.workflow_run.v1" as const;

export function isValidWorkflowRunEnvelope(
  env: UCPEnvelope<unknown>,
): env is UCPEnvelope<WorkflowRunPayload> {
  if (env.type !== WORKFLOW_RUN_TYPE) return false;
  const p = env.payload;
  if (p === null || typeof p !== "object") return false;
  if (typeof (p as WorkflowRunPayload).workflowRunId !== "string") return false;
  if (!Array.isArray((p as WorkflowRunPayload).sessionRefs)) return false;
  return true;
}

export function listWorkflowRunEnvelopes(
  storeDir: string,
): readonly UCPEnvelope<WorkflowRunPayload>[] {
  let envelopes: ReturnType<typeof getByType>;
  try {
    envelopes = getByType(storeDir, WORKFLOW_RUN_TYPE);
  } catch {
    return [];
  }
  const out: UCPEnvelope<WorkflowRunPayload>[] = [];
  for (const env of envelopes) {
    if (isValidWorkflowRunEnvelope(env)) out.push(env);
  }
  return out;
}

export function nextExecutionOrdinal(storeDir: string): number {
  let max = 0;
  for (const env of listWorkflowRunEnvelopes(storeDir)) {
    const n = env.payload.executionOrdinal;
    if (typeof n === "number" && Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function orderKey(env: UCPEnvelope<WorkflowRunPayload>) {
  return executionOrderKeyOf({
    ...(env.payload.executionOrdinal !== undefined ? { executionOrdinal: env.payload.executionOrdinal } : {}),
    ts: env.ts,
    envelopeId: env.id,
  });
}

export function latestEnvelopeOf(
  envelopes: readonly UCPEnvelope<WorkflowRunPayload>[],
): UCPEnvelope<WorkflowRunPayload> | null {
  if (envelopes.length === 0) return null;
  let latest = envelopes[0]!;
  for (let i = 1; i < envelopes.length; i++) {
    const env = envelopes[i]!;
    if (compareExecutionOrder(orderKey(env), orderKey(latest)) > 0) latest = env;
  }
  return latest;
}

/**
 * `--last` semantic: the unique workflow-run envelope that is greatest in
 * `compareExecutionOrder`. Returns that envelope's execution-instance key.
 */
export function resolveLastExecutionInstanceId(storeDir: string): string | null {
  const latest = latestEnvelopeOf(listWorkflowRunEnvelopes(storeDir));
  if (latest === null) return null;
  return executionInstanceKey(latest.payload);
}

export type ResolveExecutionInstance =
  | { readonly kind: "ok"; readonly envelope: UCPEnvelope<WorkflowRunPayload> }
  | { readonly kind: "not_found"; readonly query: string }
  | { readonly kind: "ambiguous"; readonly query: string; readonly instanceIds: readonly string[] };

/**
 * Select one execution instance.
 *
 * A query matches an envelope when it equals `executionInstanceId` or
 * `workflowRunId` (spec identity / legacy single id).
 * If the matches span more than one instance key, refuse.
 * Multiple envelopes of the same instance (re-persist) resolve to the
 * latest by `compareExecutionOrder`.
 */
export function resolveExecutionInstance(
  storeDir: string,
  query: string,
): ResolveExecutionInstance {
  const matches = listWorkflowRunEnvelopes(storeDir).filter(env =>
    env.payload.executionInstanceId === query || env.payload.workflowRunId === query,
  );
  if (matches.length === 0) return { kind: "not_found", query };

  const instanceIds: string[] = [];
  for (const env of matches) {
    const key = executionInstanceKey(env.payload);
    if (!instanceIds.includes(key)) instanceIds.push(key);
  }
  if (instanceIds.length > 1) {
    return { kind: "ambiguous", query, instanceIds };
  }

  const latest = latestEnvelopeOf(matches);
  if (latest === null) return { kind: "not_found", query };
  return { kind: "ok", envelope: latest };
}
