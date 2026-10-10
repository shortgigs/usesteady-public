/**
 * Candidate Plan Bridge (P.S1) - pure payload builder + fail-closed validator.
 *
 * `candidatePlanFromDraft` maps a kernel DRAFT `GovernedDecisionRecord` to the
 * frozen `usesteady.candidate-plan/v1` wire payload and stamps `plan_hash`. It
 * is PURE: no network, no filesystem, no clock, no env reads. It reads ONLY the
 * record (+ the run/UCP link the caller supplies) and never invents a value
 * (gauge law). It returns `null` - emit nothing - when the draft carries no
 * connected understanding or no candidate plans: an absent plan is honest
 * Unavailable on the rail, never a fabricated record.
 *
 * Privacy: operations are mapped to op kind + path ONLY. `create_file` content,
 * `replace_in_file` find/replace text, and content hashes never reach the wire.
 *
 * `validateCandidatePlanPayload` is the fail-closed gate the transport calls
 * BEFORE sending; it mirrors the Portal-side validator
 * (usesteady-ops lib/portal/candidatePlan/validate.ts). Keep the two in lockstep.
 */

import type { GovernedDecisionRecord } from "../../governed-decision/types.js";
import { hashObject } from "../../ucp/hashes.js";

import {
  CANDIDATE_PLAN_SCHEMA,
  type CandidatePlanBody,
  type CandidatePlanEntry,
  type CandidatePlanPayloadV1,
} from "./types.js";

/** The run/UCP linkage the Portal needs to attach this record to a work item. */
export type CandidatePlanLinks = {
  /** Defaults to the draft record's own recordId. */
  readonly runId?: string | null;
  /** Optional UCP bundle root id. Omitted from the wire when absent. */
  readonly ucpRootId?: string | null;
};

// ── Defensive section reading (a persisted/foreign record could be any shape) ──

type AnySection = { status?: unknown; value?: unknown } | null | undefined;

function sectionValue(section: AnySection): Record<string, unknown> | null {
  if (section === null || typeof section !== "object") return null;
  const s = (section as { status?: unknown }).status;
  if (s !== "connected" && s !== "derived") return null;
  const v = (section as { value?: unknown }).value;
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// ── The pure mapper ─────────────────────────────────────────────────────────────

/**
 * Build the `usesteady.candidate-plan/v1` payload from a kernel DRAFT record,
 * or `null` when the draft carries nothing to store (no connected
 * understanding, or an empty candidate-plan list). Never fabricates a plan.
 */
export function candidatePlanFromDraft(
  record: GovernedDecisionRecord,
  links: CandidatePlanLinks = {},
): CandidatePlanPayloadV1 | null {
  const understanding = sectionValue(record.understanding as AnySection);
  if (understanding === null) return null;

  const rawPlans = Array.isArray(understanding["candidatePlans"])
    ? (understanding["candidatePlans"] as readonly unknown[])
    : [];

  const plans: CandidatePlanEntry[] = [];
  for (const p of rawPlans) {
    if (p === null || typeof p !== "object") continue;
    const summary = (p as { summary?: unknown }).summary;
    if (!nonEmpty(summary)) continue;
    const op = (p as { operation?: unknown }).operation as
      | { kind?: unknown; path?: unknown }
      | undefined;
    // Privacy boundary: op kind + path only - contents/find/replace/hashes are
    // deliberately not read, so they cannot reach the wire.
    const operation =
      op !== null && typeof op === "object" && nonEmpty(op.kind) && nonEmpty(op.path)
        ? { op_kind: op.kind.trim(), path: op.path.trim() }
        : null;
    plans.push({
      summary: summary.trim(),
      ...(operation !== null ? { operation } : {}),
    });
  }
  if (plans.length === 0) return null;

  const humanRequest = nonEmpty(record.humanIntent?.goal)
    ? record.humanIntent.goal.trim()
    : "(no goal recorded)";
  const interpreted = nonEmpty(understanding["intent"])
    ? (understanding["intent"] as string).trim()
    : null;

  const unknowns = Array.isArray(understanding["unknowns"])
    ? (understanding["unknowns"] as readonly unknown[]).filter(nonEmpty).map((u) => u.trim())
    : [];

  // Runtime metadata (INV-WL-6): only when the producing surface recorded one.
  const attribution = nonEmpty(understanding["modelAttribution"])
    ? (understanding["modelAttribution"] as string).trim()
    : null;

  const runId = nonEmpty(links.runId) ? links.runId.trim() : record.recordId;
  const ucpRootId = nonEmpty(links.ucpRootId) ? links.ucpRootId.trim() : null;

  const body: CandidatePlanBody = {
    schema: CANDIDATE_PLAN_SCHEMA,
    record_id: record.recordId,
    created_at: record.createdAt,
    intent_summary: {
      human_request: humanRequest,
      ...(interpreted !== null && interpreted !== humanRequest
        ? { interpreted_summary: interpreted }
        : {}),
    },
    plans,
    unknowns,
    ...(attribution !== null ? { model_attribution: attribution } : {}),
    provenance_links: { run_id: runId, ...(ucpRootId !== null ? { ucp_root_id: ucpRootId } : {}) },
  };

  return attachPlanHash(body);
}

/** Stamp `plan_hash` (sha256 over the canonical, undefined-free body). */
export function attachPlanHash(body: CandidatePlanBody): CandidatePlanPayloadV1 {
  return { ...body, plan_hash: hashObject(body) };
}

// ── Fail-closed validator (faithful mirror of the Portal validator) ────────────

export type PayloadValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Keys that must never appear anywhere in the payload (recursive). Mirrors the
 * decision-record privacy posture: no reasoning, no prompts, no secrets, and -
 * specific to this bridge - no operation contents.
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
  const { plan_hash: _h, ...rest } = record;
  return rest;
}

/**
 * Validate a payload against the wire contract. The transport MUST NOT send
 * when `ok === false`.
 */
export function validateCandidatePlanPayload(body: unknown): PayloadValidation {
  const errors: string[] = [];

  if (!isObject(body)) return { ok: false, errors: ["payload must be a JSON object"] };

  if (body["schema"] !== CANDIDATE_PLAN_SCHEMA) {
    errors.push(`schema must be the literal "${CANDIDATE_PLAN_SCHEMA}"`);
  }
  if (!nonEmpty(body["record_id"])) errors.push("record_id must be a non-empty string");
  if (!isIso(body["created_at"])) errors.push("created_at must be an ISO-8601 timestamp");
  if (typeof body["plan_hash"] !== "string" || !/^[a-f0-9]{64}$/.test(body["plan_hash"])) {
    errors.push("plan_hash must be a 64-char lowercase hex sha256 digest");
  }

  const intent = body["intent_summary"];
  if (!isObject(intent) || !nonEmpty(intent["human_request"])) {
    errors.push("intent_summary.human_request is required");
  }

  const plans = body["plans"];
  if (!Array.isArray(plans) || plans.length === 0) {
    errors.push("plans must be a non-empty array");
  } else {
    for (const p of plans) {
      if (!isObject(p) || !nonEmpty(p["summary"])) {
        errors.push("each plan requires a non-empty summary");
        break;
      }
      const op = p["operation"];
      if (op !== undefined && (!isObject(op) || !nonEmpty(op["op_kind"]) || !nonEmpty(op["path"]))) {
        errors.push("plan.operation, when present, requires op_kind and path");
        break;
      }
    }
  }

  if (!Array.isArray(body["unknowns"])) {
    errors.push("unknowns must be an array");
  }

  if (body["model_attribution"] !== undefined && !nonEmpty(body["model_attribution"])) {
    errors.push("model_attribution, when present, must be a non-empty string");
  }

  const provenance = body["provenance_links"];
  if (!isObject(provenance) || !nonEmpty(provenance["run_id"])) {
    errors.push("provenance_links.run_id is required for Portal linkage");
  }

  const forbidden = findForbiddenKeys(body);
  if (forbidden.length > 0) errors.push(`Forbidden keys: ${forbidden.join(", ")}`);

  if (errors.length === 0 && typeof body["plan_hash"] === "string") {
    const expected = hashObject(stripHash(body));
    if (body["plan_hash"] !== expected) errors.push("plan_hash does not match canonical hash");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
