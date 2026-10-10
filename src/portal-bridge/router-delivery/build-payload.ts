/**
 * Router Delivery Bridge (D.S1) - pure payload builder + fail-closed validator.
 *
 * `routerDeliveryFromHandoff` maps the handoff facts the caller observed (the
 * reviewed draft's recordId, the invocation moment, the server-bound executor
 * kind) to the frozen `usesteady.router-delivery/v1` wire payload and stamps
 * `delivery_hash`. It is PURE: no network, no filesystem, no clock, no env
 * reads - the caller supplies `delivered_at` because only the handoff site
 * knows the moment. It never invents a value (gauge law) and returns `null`
 * when any required fact is missing: an unknowable delivery is honest
 * Unavailable on the rail, never a fabricated record.
 *
 * INV-DS1-3 (payload minimalism): run id, executor kind, delivered-at only.
 * There is deliberately no parameter through which ops, plans, or results
 * could enter this payload; the validator additionally hard-rejects their key
 * names anywhere in the object.
 *
 * `validateRouterDeliveryPayload` is the fail-closed gate the transport calls
 * BEFORE sending; it mirrors the Portal-side validator
 * (usesteady-ops lib/portal/routerDelivery/validate.ts). Keep the two in lockstep.
 */

import { hashObject } from "../../ucp/hashes.js";

import {
  ROUTER_DELIVERY_SCHEMA,
  type RouterDeliveryBody,
  type RouterDeliveryPayloadV1,
} from "./types.js";

/** The handoff facts the delivery site observed. Nothing else may enter. */
export type RouterDeliveryHandoff = {
  /** The reviewed DRAFT record's content-addressed recordId. */
  readonly recordId: string;
  /** ISO moment the approved ops were handed to the executor. */
  readonly deliveredAt: string;
  /** Server-bound executor backend name (e.g. "fs", "scm-github"). */
  readonly executorKind: string;
};

/** The run/UCP linkage the Portal needs to attach this record to a work item. */
export type RouterDeliveryLinks = {
  /** Defaults to the draft record's own recordId. */
  readonly runId?: string | null;
  /** Optional UCP bundle root id. Omitted from the wire when absent. */
  readonly ucpRootId?: string | null;
};

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Build the `usesteady.router-delivery/v1` payload from the observed handoff,
 * or `null` when a required fact is missing. Never fabricates a delivery.
 */
export function routerDeliveryFromHandoff(
  handoff: RouterDeliveryHandoff,
  links: RouterDeliveryLinks = {},
): RouterDeliveryPayloadV1 | null {
  if (!nonEmpty(handoff.recordId)) return null;
  if (!nonEmpty(handoff.deliveredAt) || Number.isNaN(Date.parse(handoff.deliveredAt))) return null;
  if (!nonEmpty(handoff.executorKind)) return null;

  const runId = nonEmpty(links.runId) ? links.runId.trim() : handoff.recordId.trim();
  const ucpRootId = nonEmpty(links.ucpRootId) ? links.ucpRootId.trim() : null;

  const body: RouterDeliveryBody = {
    schema: ROUTER_DELIVERY_SCHEMA,
    record_id: handoff.recordId.trim(),
    delivered_at: handoff.deliveredAt.trim(),
    executor_kind: handoff.executorKind.trim(),
    provenance_links: { run_id: runId, ...(ucpRootId !== null ? { ucp_root_id: ucpRootId } : {}) },
  };

  return attachDeliveryHash(body);
}

/** Stamp `delivery_hash` (sha256 over the canonical, undefined-free body). */
export function attachDeliveryHash(body: RouterDeliveryBody): RouterDeliveryPayloadV1 {
  return { ...body, delivery_hash: hashObject(body) };
}

// ── Fail-closed validator (faithful mirror of the Portal validator) ────────────

export type PayloadValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Keys that must never appear anywhere in the payload (recursive). The shared
 * privacy set (no reasoning, no prompts, no secrets, no operation contents)
 * PLUS the delivery-minimalism set (INV-DS1-3): a delivery record that grew
 * ops, plans, results, or any success claim is structurally rejected - the
 * Router adds nothing, and this record must never become a self-report the
 * Evidence Engine could be tempted to read (INV-WL-1).
 */
const FORBIDDEN_KEYS = new Set([
  "chain_of_thought",
  "cot",
  "private_reasoning",
  "hidden_reasoning",
  "raw_model_output",
  "raw_tokens",
  "prompt",
  "system_prompt",
  "api_key",
  "token",
  "password",
  "secret",
  "credential",
  "content",
  "find",
  "replaceWith",
  "replace_with",
  "ops",
  "operations",
  "plans",
  "results",
  "steps",
  "outcome",
  "success",
  "ranWhatWasApproved",
  "ran_what_was_approved",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function findForbiddenKeys(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  }
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) hits.push(path ? `${path}.${key}` : key);
    hits.push(...findForbiddenKeys(child, path ? `${path}.${key}` : key));
  }
  return hits;
}

function stripHash(record: Record<string, unknown>): Record<string, unknown> {
  const { delivery_hash: _h, ...rest } = record;
  return rest;
}

/**
 * Validate a payload against the wire contract. The transport MUST NOT send
 * when `ok === false`.
 */
export function validateRouterDeliveryPayload(body: unknown): PayloadValidation {
  const errors: string[] = [];

  if (!isObject(body)) return { ok: false, errors: ["payload must be a JSON object"] };

  if (body["schema"] !== ROUTER_DELIVERY_SCHEMA) {
    errors.push(`schema must be the literal "${ROUTER_DELIVERY_SCHEMA}"`);
  }
  if (!nonEmpty(body["record_id"])) errors.push("record_id must be a non-empty string");
  if (!isIso(body["delivered_at"])) errors.push("delivered_at must be an ISO-8601 timestamp");
  if (!nonEmpty(body["executor_kind"])) errors.push("executor_kind must be a non-empty string");
  if (typeof body["delivery_hash"] !== "string" || !/^[a-f0-9]{64}$/.test(body["delivery_hash"])) {
    errors.push("delivery_hash must be a 64-char lowercase hex sha256 digest");
  }

  const provenance = body["provenance_links"];
  if (!isObject(provenance) || !nonEmpty(provenance["run_id"])) {
    errors.push("provenance_links.run_id is required for Portal linkage");
  }

  const forbidden = findForbiddenKeys(body);
  if (forbidden.length > 0) errors.push(`Forbidden keys: ${forbidden.join(", ")}`);

  if (errors.length === 0 && typeof body["delivery_hash"] === "string") {
    const expected = hashObject(stripHash(body));
    if (body["delivery_hash"] !== expected) errors.push("delivery_hash does not match canonical hash");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
