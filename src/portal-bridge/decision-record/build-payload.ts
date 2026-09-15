/**
 * Decision Record Bridge (DECISION_RECORD_BRIDGE_V1) - pure payload builder.
 *
 * `decisionRecordFromGoverned` maps the kernel's canonical `GovernedDecisionRecord`
 * to the frozen `usesteady.decision-record/v1` wire payload and stamps
 * `record_hash`. It is PURE: no network, no filesystem, no clock, no env reads.
 * It reads ONLY the record (+ the run/UCP link the caller supplies) and the
 * record's epistemic classification - it never invents a value (gauge law).
 *
 * `validateDecisionRecordPayload` is the fail-closed gate the transport step calls
 * BEFORE sending: a payload that does not validate is never POSTed. It is a
 * faithful mirror of the Portal-side validator
 * (usesteady-ops lib/portal/decisionRecord/validate.ts) so a payload Core accepts
 * is one the Portal endpoint accepts on type grounds (auth + idempotency are
 * separate, server-side concerns). Keep the two in lockstep.
 *
 * Hash parity (INV-DEC-012): the digest is computed with src/ucp/hashes.ts
 * `hashObject`, which the Portal mirrors in canonicalHash.ts. The body is built
 * UNDEFINED-FREE (optional keys omitted, never set to undefined) so it survives
 * JSON.stringify -> JSON.parse unchanged, and the Portal's recompute over the
 * parsed body reproduces this exact digest.
 */

import { classifyEpistemic } from "../../governed-decision/epistemic.js";
import type { GovernedDecisionRecord } from "../../governed-decision/types.js";
import { hashObject } from "../../ucp/hashes.js";

import {
  DECISION_RECORD_SCHEMA,
  type DecisionRecordArtifactChange,
  type DecisionRecordAuthority,
  type DecisionRecordBody,
  type DecisionRecordCertification,
  type DecisionRecordEpistemicObject,
  type DecisionRecordExecutionOutcome,
  type DecisionRecordExecutionResult,
  type DecisionRecordFactor,
  type DecisionRecordPayloadV1,
  type DecisionRecordReality,
  type DecisionRecordReference,
} from "./types.js";

/** The run/UCP linkage Portal needs to attach this record to a run row. */
export type DecisionRecordLinks = {
  /** Required for Portal linkage. Defaults to the record's own recordId. */
  readonly runId?: string | null;
  /** Optional UCP bundle root id. Omitted from the wire when absent. */
  readonly ucpRootId?: string | null;
};

// ─── Defensive section reading (a persisted/foreign record could be any shape) ──

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

// ─── The pure mapper ───────────────────────────────────────────────────────────

/**
 * Build the `usesteady.decision-record/v1` payload from a kernel record.
 *
 * Always produces a `post_execution` record (the kernel emits FINALs). Optional
 * blocks (`reality`, `artifacts_changed`) are included ONLY when their source
 * section is real - omitted otherwise, never fabricated.
 */
export function decisionRecordFromGoverned(
  record: GovernedDecisionRecord,
  links: DecisionRecordLinks = {},
): DecisionRecordPayloadV1 {
  const humanRequest = nonEmpty(record.humanIntent?.goal)
    ? record.humanIntent.goal.trim()
    : "(no goal recorded)";

  const understanding = sectionValue(record.understanding as AnySection);
  const constitution = sectionValue(record.constitution as AnySection);
  const truth = sectionValue(record.truthArbitration as AnySection);
  const ratification = sectionValue(record.ratification as AnySection);
  const execution = sectionValue(record.execution as AnySection);
  const observation = sectionValue(record.observation as AnySection);

  // ── plan_summary.summary: must be non-empty AND must differ from human_request
  //    (Portal SG rule). Prefer the kernel's own plan/intent text; never invent.
  const planSummary = derivePlanSummary(understanding, humanRequest);
  const phaseState = execution !== null ? "executed" : "ratified";

  // ── rationale: kernel's derived resolution + applied invariants as factors.
  const rationaleSummary = nonEmpty(truth?.["resolution"])
    ? (truth!["resolution"] as string).trim()
    : "Ratified governed decision.";
  const factors = deriveFactors(constitution, ratification);

  // ── authority + approval (the ratification verdict — sole authority).
  const decision = nonEmpty(ratification?.["decision"]) ? (ratification!["decision"] as string) : null;
  const approver = nonEmpty(ratification?.["approver"]) ? (ratification!["approver"] as string) : null;
  const ratifiedAt = nonEmpty(ratification?.["at"]) ? (ratification!["at"] as string) : null;
  // Typed seat (S1 / INV-SO-2), verbatim from the kernel record. null = a
  // record ratified before the field existed (honest absence, never "human").
  const rawKind = ratification?.["approverKind"];
  const approverKind = rawKind === "human" || rawKind === "persona" ? rawKind : null;
  const realityVerdict = nonEmpty(observation?.["realityVerdict"])
    ? (observation!["realityVerdict"] as string)
    : "unknown";

  const authority: DecisionRecordAuthority = {
    gate_state: decision ?? "unavailable",
    approver,
    approver_kind: approverKind,
    ratified_at: ratifiedAt,
    reality_verdict: realityVerdict,
  };

  // ── interpreted_summary (optional) from understanding.intent, when present.
  const interpreted = nonEmpty(understanding?.["intent"]) ? (understanding!["intent"] as string).trim() : null;

  // ── execution_outcome + artifacts_changed from the execution section.
  const executionOutcome = deriveExecutionOutcome(execution);
  const artifactsChanged = deriveArtifactsChanged(executionOutcome);

  // ── reality (optional) from the observation section, when a probe ran.
  const reality = deriveReality(observation);

  // ── epistemic objects (read-side classification of the same record).
  const epistemic = deriveEpistemic(record);

  // ── kernel certification (USESTEADY_PORTAL_HANDOFF_CERT_V1) — additive.
  //    Omitted when truthArbitration has no certification object (hash-stable).
  const certification = deriveCertification(truth);

  // ── Explicit Invocation Lineage edges (declared references), kernel-resolved.
  const references = deriveReferences(record);

  const runId = nonEmpty(links.runId) ? links.runId.trim() : record.recordId;
  const ucpRootId = nonEmpty(links.ucpRootId) ? links.ucpRootId.trim() : null;

  // Assemble the body UNDEFINED-FREE (optional keys omitted, not set undefined).
  const body: DecisionRecordBody = {
    schema: DECISION_RECORD_SCHEMA,
    record_id: record.recordId,
    record_phase: "post_execution",
    created_at: record.createdAt,
    intent_summary: {
      human_request: humanRequest,
      ...(interpreted !== null && interpreted !== humanRequest ? { interpreted_summary: interpreted } : {}),
    },
    plan_summary: { summary: planSummary, phase_state: phaseState },
    rationale_summary: { summary: rationaleSummary, factors },
    authority,
    provenance_links: { run_id: runId, ...(ucpRootId !== null ? { ucp_root_id: ucpRootId } : {}) },
    approval:
      decision !== null ? { decision, approver, at: ratifiedAt } : null,
    execution_outcome: executionOutcome,
    epistemic,
    ...(certification !== null ? { certification } : {}),
    ...(reality !== null ? { reality } : {}),
    ...(artifactsChanged.length > 0 ? { artifacts_changed: artifactsChanged } : {}),
    ...(references.length > 0 ? { references } : {}),
  };

  return attachRecordHash(body);
}

/** Stamp `record_hash` (sha256 over the canonical, undefined-free body). */
export function attachRecordHash(body: DecisionRecordBody): DecisionRecordPayloadV1 {
  return { ...body, record_hash: hashObject(body) };
}

// ─── Derivations (each reads ONLY the record; invents nothing) ─────────────────

function derivePlanSummary(
  understanding: Record<string, unknown> | null,
  humanRequest: string,
): string {
  const plans = Array.isArray(understanding?.["candidatePlans"])
    ? (understanding!["candidatePlans"] as readonly unknown[])
    : [];
  for (const p of plans) {
    if (p !== null && typeof p === "object" && nonEmpty((p as { summary?: unknown }).summary)) {
      const s = ((p as { summary: string }).summary).trim();
      if (s !== humanRequest) return s;
    }
  }
  const intent = nonEmpty(understanding?.["intent"]) ? (understanding!["intent"] as string).trim() : null;
  if (intent !== null && intent !== humanRequest) return intent;
  // Fallback that is guaranteed non-empty AND distinct from human_request.
  return `Govern and ratify: ${humanRequest}`;
}

function deriveFactors(
  constitution: Record<string, unknown> | null,
  ratification: Record<string, unknown> | null,
): readonly DecisionRecordFactor[] {
  const invariants = Array.isArray(constitution?.["appliedInvariants"])
    ? (constitution!["appliedInvariants"] as readonly unknown[])
    : [];
  const factors: DecisionRecordFactor[] = [];
  for (const inv of invariants) {
    if (nonEmpty(inv)) factors.push({ category: "constitution", statement: inv.trim() });
  }
  if (factors.length === 0) {
    const decision = nonEmpty(ratification?.["decision"]) ? (ratification!["decision"] as string) : "ratified";
    const approver = nonEmpty(ratification?.["approver"]) ? (ratification!["approver"] as string) : "human";
    // Seat-honest label (INV-SO-2): a persona ratification must never be
    // narrated as "Human". Unrecorded kind (pre-S1 record) falls back to the
    // neutral "Ratified" rather than asserting a seat the record does not carry.
    const kind = ratification?.["approverKind"];
    const seatLabel = kind === "persona" ? "Persona" : kind === "human" ? "Human" : "Decision";
    factors.push({ category: "ratification", statement: `${seatLabel} ${decision} by ${approver}.` });
  }
  return factors;
}

function deriveExecutionOutcome(
  execution: Record<string, unknown> | null,
): DecisionRecordExecutionOutcome | null {
  if (execution === null) return null;
  const rawResults = Array.isArray(execution["results"]) ? (execution["results"] as readonly unknown[]) : [];
  const results: DecisionRecordExecutionResult[] = [];
  for (const r of rawResults) {
    if (r === null || typeof r !== "object") continue;
    const op = (r as { op?: unknown }).op as { kind?: unknown; path?: unknown } | undefined;
    results.push({
      op_kind: nonEmpty(op?.kind) ? (op!.kind as string) : "unknown",
      path: nonEmpty(op?.path) ? (op!.path as string) : "",
      status: nonEmpty((r as { status?: unknown }).status) ? ((r as { status: string }).status) : "unknown",
      detail: typeof (r as { detail?: unknown }).detail === "string" ? ((r as { detail: string }).detail) : "",
    });
  }
  return {
    ran_what_was_approved: execution["ranWhatWasApproved"] === true,
    deterministic: execution["deterministic"] === true,
    results,
  };
}

function deriveArtifactsChanged(
  outcome: DecisionRecordExecutionOutcome | null,
): readonly DecisionRecordArtifactChange[] {
  if (outcome === null) return [];
  const changes: DecisionRecordArtifactChange[] = [];
  for (const r of outcome.results) {
    if (r.status === "ran" && nonEmpty(r.path)) {
      changes.push({ path: r.path, change_type: "create" });
    }
  }
  return changes;
}

function deriveReality(observation: Record<string, unknown> | null): DecisionRecordReality | null {
  if (observation === null) return null;
  const verdict = nonEmpty(observation["realityVerdict"]) ? (observation["realityVerdict"] as string) : "unknown";
  const intendedVsActual = nonEmpty(observation["intendedVsActual"])
    ? (observation["intendedVsActual"] as string)
    : "unknown";
  const detail = nonEmpty(observation["realityDetail"]) ? (observation["realityDetail"] as string) : null;
  return {
    verdict,
    intended_vs_actual: intendedVsActual,
    ...(detail !== null ? { detail } : {}),
  };
}

/**
 * Map the record's kernel-resolved reference edges to the wire shape. Reads ONLY
 * `record.references`, defensively (a persisted/foreign record could be any shape).
 * Gauge law: an edge missing a kind/ref/band is SKIPPED, never fabricated - the
 * kernel always emits complete edges, so a missing field means foreign data, not a
 * value to invent. Returns [] for a fresh invocation, so the caller omits the key.
 */
function deriveReferences(record: GovernedDecisionRecord): readonly DecisionRecordReference[] {
  const raw = (record as { references?: unknown }).references;
  if (!Array.isArray(raw)) return [];
  const out: DecisionRecordReference[] = [];
  for (const edge of raw) {
    if (edge === null || typeof edge !== "object") continue;
    const kind = (edge as { kind?: unknown }).kind;
    const ref = (edge as { ref?: unknown }).ref;
    const band = (edge as { authorityBand?: unknown }).authorityBand;
    if (!nonEmpty(kind) || !nonEmpty(ref) || !nonEmpty(band)) continue;
    out.push({
      kind: kind.trim(),
      ref: ref.trim(),
      authority_band: band.trim(),
      verified_in_this_invocation: (edge as { verifiedInThisInvocation?: unknown }).verifiedInThisInvocation === true,
    });
  }
  return out;
}

function deriveEpistemic(record: GovernedDecisionRecord): readonly DecisionRecordEpistemicObject[] {
  return classifyEpistemic(record).map((o) => ({
    kind: o.kind,
    status: o.status,
    ...(o.statement !== undefined ? { statement: o.statement } : {}),
  }));
}

/**
 * Map kernel truthArbitration.certification onto the wire. Gauge law: omit
 * when the section value has no certification object — never invent a level.
 */
function deriveCertification(
  truth: Record<string, unknown> | null,
): DecisionRecordCertification | null {
  if (truth === null) return null;
  const cert = truth["certification"];
  if (cert === null || typeof cert !== "object") return null;
  const level = (cert as { level?: unknown }).level;
  if (!nonEmpty(level)) return null;
  const rawReasons = (cert as { reasons?: unknown }).reasons;
  const reasons: Array<DecisionRecordCertification["reasons"][number]> = [];
  if (Array.isArray(rawReasons)) {
    for (const r of rawReasons) {
      if (r === null || typeof r !== "object") continue;
      const basis = (r as { basis?: unknown }).basis;
      const authorityLevel = (r as { authorityLevel?: unknown }).authorityLevel;
      if (!nonEmpty(basis) || !nonEmpty(authorityLevel)) continue;
      reasons.push({ basis: basis.trim(), authority_level: authorityLevel.trim() });
    }
  }
  const conf = truth["certifiedConfidence"];
  const certified_confidence: number | "unknown" =
    typeof conf === "number" && Number.isFinite(conf)
      ? conf
      : conf === "unknown"
        ? "unknown"
        : "unknown";
  return {
    level: level.trim(),
    reasons,
    certified_confidence,
  };
}

// ─── Fail-closed validator (faithful mirror of the Portal validator) ───────────

export type PayloadValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

const PHASES: ReadonlySet<string> = new Set(["pre_approval", "post_execution"]);

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
  const { record_hash: _h, ...rest } = record;
  return rest;
}

/**
 * Validate a payload against the Portal contract. Mirrors
 * lib/portal/decisionRecord/validate.ts (Lane B) so the transport gate agrees
 * with the server. The transport MUST NOT send when `ok === false`.
 */
export function validateDecisionRecordPayload(body: unknown): PayloadValidation {
  const errors: string[] = [];

  if (!isObject(body)) return { ok: false, errors: ["payload must be a JSON object"] };

  if (body["schema"] !== DECISION_RECORD_SCHEMA) {
    errors.push(`schema must be the literal "${DECISION_RECORD_SCHEMA}"`);
  }
  if (!nonEmpty(body["record_id"])) errors.push("record_id must be a non-empty string");

  const phase = body["record_phase"];
  if (!PHASES.has(phase as string)) errors.push("record_phase must be pre_approval or post_execution");

  if (!isIso(body["created_at"])) errors.push("created_at must be an ISO-8601 timestamp");

  if (typeof body["record_hash"] !== "string" || !/^[a-f0-9]{64}$/.test(body["record_hash"])) {
    errors.push("record_hash must be a 64-char lowercase hex sha256 digest");
  }

  const intent = body["intent_summary"];
  if (!isObject(intent) || !nonEmpty(intent["human_request"])) {
    errors.push("intent_summary.human_request is required");
  }

  const plan = body["plan_summary"];
  if (!isObject(plan) || !nonEmpty(plan["summary"])) {
    errors.push("plan_summary.summary is required");
  } else if (
    isObject(intent) &&
    nonEmpty(intent["human_request"]) &&
    (intent["human_request"] as string).trim() === (plan["summary"] as string).trim()
  ) {
    errors.push("intent_summary.human_request must not equal plan_summary.summary");
  }

  const rationale = body["rationale_summary"];
  if (!isObject(rationale) || !Array.isArray(rationale["factors"]) || rationale["factors"].length === 0) {
    errors.push("rationale_summary.factors must be a non-empty array");
  } else {
    for (const f of rationale["factors"]) {
      if (!isObject(f) || !nonEmpty(f["category"]) || !nonEmpty(f["statement"])) {
        errors.push("each rationale factor requires category and statement");
        break;
      }
    }
  }

  if (!isObject(body["authority"])) errors.push("authority must be an object");

  for (const key of ["assumptions", "alternatives_considered", "constraints_applied", "risks"] as const) {
    if (body[key] !== undefined && !Array.isArray(body[key])) {
      errors.push(`${key} must be an array when present`);
    }
  }

  const provenance = body["provenance_links"];
  if (!isObject(provenance)) {
    errors.push("provenance_links must be an object");
  } else if (!nonEmpty(provenance["run_id"])) {
    errors.push("provenance_links.run_id is required for Portal linkage");
  }

  if (phase === "pre_approval") {
    if (body["approval"] !== null) errors.push("approval must be null in pre_approval phase");
    if (body["execution_outcome"] !== null) errors.push("execution_outcome must be null in pre_approval phase");
    if (isObject(plan) && plan["phase_state"] !== "proposed") {
      errors.push("plan_summary.phase_state must be proposed in pre_approval phase");
    }
    if (isObject(body["authority"]) && body["authority"]["gate_state"] !== "pending_human_approval") {
      errors.push("authority.gate_state must be pending_human_approval in pre_approval phase");
    }
  }

  if (body["references"] !== undefined) {
    if (!Array.isArray(body["references"])) {
      errors.push("references must be an array when present");
    } else {
      for (const r of body["references"]) {
        if (
          !isObject(r) ||
          !nonEmpty(r["kind"]) ||
          !nonEmpty(r["ref"]) ||
          !nonEmpty(r["authority_band"]) ||
          typeof r["verified_in_this_invocation"] !== "boolean"
        ) {
          errors.push(
            "each reference requires non-empty kind, ref, authority_band and a boolean verified_in_this_invocation",
          );
          break;
        }
      }
    }
  }

  // Kernel certification (additive + optional). USESTEADY_PORTAL_HANDOFF_CERT_V1.
  if (body["certification"] !== undefined) {
    if (!isObject(body["certification"])) {
      errors.push("certification must be an object when present");
    } else {
      const c = body["certification"];
      if (!nonEmpty(c["level"])) {
        errors.push("certification.level must be a non-empty string");
      }
      if (!Array.isArray(c["reasons"])) {
        errors.push("certification.reasons must be an array");
      } else {
        for (const r of c["reasons"]) {
          if (!isObject(r) || !nonEmpty(r["basis"]) || !nonEmpty(r["authority_level"])) {
            errors.push("each certification reason requires basis and authority_level");
            break;
          }
        }
      }
      const conf = c["certified_confidence"];
      if (!(typeof conf === "number" && Number.isFinite(conf)) && conf !== "unknown") {
        errors.push('certification.certified_confidence must be a number or the literal "unknown"');
      }
    }
  }

  const forbidden = findForbiddenKeys(body);
  if (forbidden.length > 0) errors.push(`Forbidden keys: ${forbidden.join(", ")}`);

  if (errors.length === 0 && typeof body["record_hash"] === "string") {
    const expected = hashObject(stripHash(body));
    if (body["record_hash"] !== expected) errors.push("record_hash does not match canonical hash");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
