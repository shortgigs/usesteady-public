/**
 * P1 Authority Assertion V1 — Core-side fail-closed verifier.
 *
 * Verification has TWO independent halves, both required:
 *   1. AUTHENTICITY — the Ed25519 signature over the canonical payload verifies
 *      against the Portal authority public key PINNED in Core's environment
 *      (never against the key embedded in the assertion — that embedded key is
 *      diagnostic only and must merely EQUAL the pinned one).
 *   2. BINDING — every expected field equals the exact live gate Core is
 *      deciding on (org, run/thread, step, decision, decided_at, basis,
 *      subject/display, decision_id). A valid signature for decision A must
 *      never authorize decision B.
 *
 * Any failure returns ok:false with a machine-readable reason; callers treat a
 * failed verification as "no verified authority evidence" and fail closed per
 * path (approve degrades to local approval / ratify is refused).
 */

import { createHash, createPublicKey, verify as ed25519Verify } from "node:crypto";

import { canonicalizeJson } from "./canonical.js";
import {
  validateMappedRetirementEnvelopePair,
  type MappedRetirementEnvelopeReader,
} from "../../claude/evidence-basis.js";
import type { PortalAuthorityTrust } from "./trust.js";
import {
  AUTHORITY_ASSERTION_SCHEMA,
  AUTHORITY_ASSERTION_V2_SCHEMA,
  AUTHORITY_DECISION_RELATION_RETIREMENT,
  AUTHORITY_DECISION_RELATION_SUPERSESSION,
  DECISION_ORIGIN_SCHEMA,
  RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA,
  RETIREMENT_DECISION_ORIGIN_V2_SCHEMA,
  type AuthorityAssertionModelPositionRef,
  type AuthorityAssertionPayloadV1,
  type AuthorityAssertionV1,
  type AuthorityVerificationResult,
  type DecisionOriginAuthorityVerificationResult,
  type DecisionOriginAuthorityAssertionV2,
  type DecisionOriginV1,
  type ExpectedAuthorityBinding,
  type RetirementAuthorityAssertionV3,
  type RetirementAuthorityVerificationResult,
  type RetirementBasisRelationV1,
  type RetirementDecisionOriginV2,
} from "./types.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isNonNegIntOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
}
function isIso(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
}
function isCleanString(v: unknown, nonEmpty = true): v is string {
  return (
    typeof v === "string" &&
    !v.includes("\u0000") &&
    (!nonEmpty || v.length > 0)
  );
}
function isHex64(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

const EXACT_ORIGIN_V2_KEYS = [
  "approver_display",
  "authenticated_actor",
  "authority_subject_id",
  "authorized_context",
  "decided_at",
  "decision",
  "decision_basis",
  "decision_id",
  "decision_relation",
  "gate_cycle",
  "organization_id",
  "origin_id",
  "retirement_basis_relations",
  "run_id",
  "schema",
  "step_index",
].sort().join(",");

function parseRetirementRelation(raw: unknown): RetirementBasisRelationV1 | null {
  if (!isObject(raw) || Object.keys(raw).sort().join(",") !== "model_position,resolving_evidence") return null;
  const o = raw["model_position"];
  const e = raw["resolving_evidence"];
  if (
    !isObject(o) ||
    Object.keys(o).sort().join(",") !== "model_position_id,position_hash" ||
    !isObject(e) ||
    Object.keys(e).sort().join(",") !== "evidence_basis_hash,evidence_basis_id" ||
    !isHex64(o["model_position_id"]) ||
    !isHex64(o["position_hash"]) ||
    !isHex64(e["evidence_basis_id"]) ||
    !isHex64(e["evidence_basis_hash"])
  ) return null;
  return raw as unknown as RetirementBasisRelationV1;
}

export function canonicalRetirementRelations(
  relations: readonly RetirementBasisRelationV1[],
): string {
  const tuples = relations.map((relation) => [
    relation.model_position.model_position_id,
    relation.model_position.position_hash,
    relation.resolving_evidence.evidence_basis_id,
    relation.resolving_evidence.evidence_basis_hash,
  ] as const);
  tuples.sort((a, b) => {
    for (let i = 0; i < 4; i += 1) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  });
  return JSON.stringify(tuples);
}

export function parseRetirementDecisionOriginV2(raw: unknown): RetirementDecisionOriginV2 | null {
  if (
    !isObject(raw) ||
    raw["schema"] !== RETIREMENT_DECISION_ORIGIN_V2_SCHEMA ||
    Object.keys(raw).sort().join(",") !== EXACT_ORIGIN_V2_KEYS
  ) return null;
  const actor = raw["authenticated_actor"];
  const context = raw["authorized_context"];
  const relations = raw["retirement_basis_relations"];
  if (
    !isObject(actor) ||
    Object.keys(actor).sort().join(",") !== "provider,subject_id" ||
    actor["provider"] !== "supabase" ||
    !isCleanString(actor["subject_id"]) ||
    !isObject(context) ||
    Object.keys(context).sort().join(",") !== "capability,role" ||
    (context["role"] !== "org:admin" && context["role"] !== "org:member") ||
    context["capability"] !== "approve_steps" ||
    raw["decision"] !== "approve" ||
    raw["decision_relation"] !== AUTHORITY_DECISION_RELATION_RETIREMENT ||
    !isIso(raw["decided_at"]) ||
    !isHex64(raw["decision_basis"]) ||
    !Number.isSafeInteger(raw["step_index"]) ||
    (raw["step_index"] as number) < 0 ||
    !Number.isSafeInteger(raw["gate_cycle"]) ||
    (raw["gate_cycle"] as number) < 0 ||
    !Array.isArray(relations) ||
    relations.length < 1 ||
    relations.length > 8
  ) return null;
  for (const field of ["origin_id", "decision_id", "authority_subject_id", "organization_id", "run_id"]) {
    if (!isCleanString(raw[field])) return null;
  }
  if (raw["approver_display"] !== null && !isCleanString(raw["approver_display"], false)) return null;
  const parsed = relations.map(parseRetirementRelation);
  if (parsed.some((relation) => relation === null)) return null;
  const typed = parsed as RetirementBasisRelationV1[];
  const o = new Set(typed.map((r) => `${r.model_position.model_position_id}:${r.model_position.position_hash}`));
  const e = new Set(typed.map((r) => `${r.resolving_evidence.evidence_basis_id}:${r.resolving_evidence.evidence_basis_hash}`));
  if (o.size !== typed.length || e.size !== typed.length) return null;
  const storedTuples = JSON.stringify(typed.map((relation) => [
    relation.model_position.model_position_id,
    relation.model_position.position_hash,
    relation.resolving_evidence.evidence_basis_id,
    relation.resolving_evidence.evidence_basis_hash,
  ]));
  if (canonicalRetirementRelations(typed) !== storedTuples) return null;
  return raw as unknown as RetirementDecisionOriginV2;
}

export function parseRetirementAuthorityAssertionV3(
  raw: unknown,
):
  | { readonly ok: true; readonly assertion: RetirementAuthorityAssertionV3 }
  | { readonly ok: false } {
  if (!isObject(raw) || raw["schema"] !== RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA) return { ok: false };
  const payload = raw["payload"];
  const signature = raw["signature"];
  if (
    !isObject(payload) ||
    Object.keys(payload).sort().join(",") !== "decision_origin,decision_origin_hash,key_id,version" ||
    payload["version"] !== RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA ||
    !parseRetirementDecisionOriginV2(payload["decision_origin"]) ||
    !isHex64(payload["decision_origin_hash"]) ||
    !isCleanString(payload["key_id"]) ||
    !isObject(signature) ||
    Object.keys(signature).sort().join(",") !== "algorithm,public_key,signature,signed_at" ||
    signature["algorithm"] !== "Ed25519" ||
    !isCleanString(signature["public_key"]) ||
    !isCleanString(signature["signature"]) ||
    !isIso(signature["signed_at"])
  ) return { ok: false };
  return { ok: true, assertion: raw as unknown as RetirementAuthorityAssertionV3 };
}
function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
}

function parseDecisionOrigin(raw: unknown): DecisionOriginV1 | null {
  if (!isObject(raw) || raw["schema"] !== DECISION_ORIGIN_SCHEMA) return null;
  const actor = raw["authenticated_actor"];
  const context = raw["authorized_context"];
  if (!isObject(actor) || actor["provider"] !== "supabase" || !isCleanString(actor["subject_id"])) return null;
  if (
    !isObject(context) ||
    (context["role"] !== "org:admin" && context["role"] !== "org:member") ||
    context["capability"] !== "approve_steps"
  ) return null;
  const strings = [
    raw["origin_id"],
    raw["decision_id"],
    raw["authority_subject_id"],
    raw["organization_id"],
    raw["run_id"],
  ];
  if (strings.some((value) => !isCleanString(value))) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw["origin_id"] as string,
    )
  ) return null;
  if (raw["approver_display"] !== null && !isCleanString(raw["approver_display"], false)) return null;
  if (raw["decision"] !== "approve" && raw["decision"] !== "reject") return null;
  if (!isCleanString(raw["decided_at"]) || !isIso(raw["decided_at"])) return null;
  if (!Number.isSafeInteger(raw["step_index"]) || (raw["step_index"] as number) < 0) return null;
  if (!Number.isSafeInteger(raw["gate_cycle"]) || (raw["gate_cycle"] as number) < 0) return null;
  if (!isHex64(raw["decision_basis"])) return null;
  const relation = raw["decision_relation"];
  if (
    relation !== null &&
    relation !== AUTHORITY_DECISION_RELATION_SUPERSESSION &&
    relation !== AUTHORITY_DECISION_RELATION_RETIREMENT
  ) return null;
  if (
    !Array.isArray(raw["model_positions"]) ||
    raw["model_positions"].length > 8 ||
    !Array.isArray(raw["resolving_evidence_ids"]) ||
    raw["resolving_evidence_ids"].length > 16
  ) return null;
  const modelPositions: AuthorityAssertionModelPositionRef[] = [];
  for (const item of raw["model_positions"]) {
    if (!isObject(item) || !isHex64(item["model_position_id"]) || !isHex64(item["position_hash"])) return null;
    modelPositions.push({
      model_position_id: item["model_position_id"],
      position_hash: item["position_hash"],
    });
  }
  const resolvingIds: string[] = [];
  for (const id of raw["resolving_evidence_ids"]) {
    if (!isHex64(id)) return null;
    resolvingIds.push(id);
  }
  if (relation === null && (modelPositions.length !== 0 || resolvingIds.length !== 0)) return null;
  if (relation === AUTHORITY_DECISION_RELATION_SUPERSESSION && (modelPositions.length === 0 || resolvingIds.length !== 0)) return null;
  if (relation === AUTHORITY_DECISION_RELATION_RETIREMENT && (modelPositions.length === 0 || resolvingIds.length === 0)) return null;
  return raw as unknown as DecisionOriginV1;
}

function parseV2(raw: Record<string, unknown>): DecisionOriginAuthorityAssertionV2 | null {
  if (raw["schema"] !== AUTHORITY_ASSERTION_V2_SCHEMA) return null;
  const payload = raw["payload"];
  const signature = raw["signature"];
  if (!isObject(payload) || payload["version"] !== AUTHORITY_ASSERTION_V2_SCHEMA) return null;
  const origin = parseDecisionOrigin(payload["decision_origin"]);
  if (!origin || !isHex64(payload["decision_origin_hash"]) || !isCleanString(payload["key_id"])) return null;
  if (
    !isObject(signature) ||
    signature["algorithm"] !== "Ed25519" ||
    !isCleanString(signature["public_key"]) ||
    !isCleanString(signature["signature"]) ||
    !isCleanString(signature["signed_at"]) ||
    !isIso(signature["signed_at"])
  ) return null;
  return raw as unknown as DecisionOriginAuthorityAssertionV2;
}

/** Structural parse of an untrusted assertion envelope. No crypto here. */
export function parseAuthorityAssertion(
  raw: unknown,
): { readonly ok: true; readonly assertion: AuthorityAssertionV1 } | { readonly ok: false } {
  if (!isObject(raw)) return { ok: false };
  if (raw["schema"] !== AUTHORITY_ASSERTION_SCHEMA) return { ok: false };

  const p = raw["payload"];
  if (!isObject(p)) return { ok: false };
  if (p["version"] !== AUTHORITY_ASSERTION_SCHEMA) return { ok: false };
  if (!isString(p["decision_id"]) || p["decision_id"].length === 0) return { ok: false };
  if (!isString(p["organization_id"]) || p["organization_id"].length === 0) return { ok: false };
  if (!isString(p["authority_subject_id"]) || p["authority_subject_id"].length === 0) {
    return { ok: false };
  }
  if (!isStringOrNull(p["approver_display"])) return { ok: false };
  if (p["decision"] !== "approve" && p["decision"] !== "reject") return { ok: false };
  if (!isIso(p["decided_at"])) return { ok: false };
  if (!isStringOrNull(p["run_id"])) return { ok: false };
  if (!isStringOrNull(p["thread_id"])) return { ok: false };
  if (!isNonNegIntOrNull(p["step_index"])) return { ok: false };
  if (!isString(p["decision_basis"]) || p["decision_basis"].length === 0) return { ok: false };
  if (!isString(p["key_id"]) || p["key_id"].length === 0) return { ok: false };

  // P3 Phase 2 / P5 V1 (additive): validate optional decision-relation fields
  // when present. Unknown-shape values are malformed — never silently ignored.
  if (p["decision_relation"] !== undefined) {
    const rel = p["decision_relation"];
    if (
      rel !== AUTHORITY_DECISION_RELATION_SUPERSESSION &&
      rel !== AUTHORITY_DECISION_RELATION_RETIREMENT
    ) {
      return { ok: false };
    }
    const mps = p["model_positions"];
    if (!Array.isArray(mps) || mps.length === 0 || mps.length > 8) return { ok: false };
    for (const mp of mps) {
      if (!isObject(mp)) return { ok: false };
      if (!/^[0-9a-f]{64}$/.test(String(mp["model_position_id"]))) return { ok: false };
      if (!/^[0-9a-f]{64}$/.test(String(mp["position_hash"]))) return { ok: false };
    }
    if (rel === AUTHORITY_DECISION_RELATION_RETIREMENT) {
      const ev = p["resolving_evidence_ids"];
      if (!Array.isArray(ev) || ev.length === 0 || ev.length > 16) return { ok: false };
      for (const id of ev) {
        if (!/^[0-9a-f]{64}$/.test(String(id))) return { ok: false };
      }
    } else if (p["resolving_evidence_ids"] !== undefined) {
      // proceed_despite must not carry retirement evidence — refuse masquerade.
      return { ok: false };
    }
  } else if (p["model_positions"] !== undefined || p["resolving_evidence_ids"] !== undefined) {
    return { ok: false };
  }

  const s = raw["signature"];
  if (!isObject(s)) return { ok: false };
  if (s["algorithm"] !== "Ed25519") return { ok: false };
  if (!isString(s["public_key"]) || !isString(s["signature"]) || !isIso(s["signed_at"])) {
    return { ok: false };
  }

  const payload = p as unknown as AuthorityAssertionPayloadV1;
  return {
    ok: true,
    assertion: {
      schema: AUTHORITY_ASSERTION_SCHEMA,
      payload,
      signature: {
        algorithm: "Ed25519",
        public_key: s["public_key"],
        signature: s["signature"],
        signed_at: s["signed_at"],
      },
    },
  };
}

export function parseDecisionOriginAuthorityAssertionV2(
  raw: unknown,
):
  | { readonly ok: true; readonly assertion: DecisionOriginAuthorityAssertionV2 }
  | { readonly ok: false } {
  if (!isObject(raw)) return { ok: false };
  const assertion = parseV2(raw);
  return assertion ? { ok: true, assertion } : { ok: false };
}

function bindingMismatch(
  field: string,
  actual: unknown,
  expected: unknown,
): { readonly ok: false; readonly reason: `binding_mismatch:${string}` } | null {
  return actual === expected
    ? null
    : { ok: false, reason: `binding_mismatch:${field}` };
}

/** Deterministic exact-set comparison of signed model position refs (sorted). */
function canonicalModelPositions(
  refs: readonly AuthorityAssertionModelPositionRef[],
): string {
  const sorted = [...refs].sort((a, b) =>
    a.model_position_id === b.model_position_id
      ? a.position_hash.localeCompare(b.position_hash)
      : a.model_position_id.localeCompare(b.model_position_id),
  );
  return canonicalizeJson(
    sorted.map((r) => ({
      model_position_id: r.model_position_id,
      position_hash: r.position_hash,
    })),
  );
}

function verifyV2(
  assertion: DecisionOriginAuthorityAssertionV2,
  trust: PortalAuthorityTrust,
  expected: ExpectedAuthorityBinding,
): DecisionOriginAuthorityVerificationResult {
  const { payload } = assertion;
  const { decision_origin: origin } = payload;
  const pinned = trust.keys.get(payload.key_id);
  if (pinned === undefined) return { ok: false, reason: "unknown_key_id" };
  if (assertion.signature.public_key !== pinned) {
    return { ok: false, reason: "embedded_key_mismatch" };
  }

  let originCanonical: string;
  let payloadCanonical: string;
  try {
    originCanonical = canonicalizeJson(origin);
    payloadCanonical = canonicalizeJson(payload);
  } catch {
    return { ok: false, reason: "malformed_assertion" };
  }
  const recomputedHash = createHash("sha256").update(originCanonical, "utf8").digest("hex");
  if (recomputedHash !== payload.decision_origin_hash) {
    return { ok: false, reason: "binding_mismatch:decision_origin_hash" };
  }
  try {
    const valid = ed25519Verify(
      null,
      Buffer.from(payloadCanonical, "utf8"),
      createPublicKey({ key: Buffer.from(pinned, "base64"), format: "der", type: "spki" }),
      Buffer.from(assertion.signature.signature, "base64"),
    );
    if (!valid) return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  const checks: (
    | { readonly ok: false; readonly reason: `binding_mismatch:${string}` }
    | null
  )[] = [
    bindingMismatch("organization_id", origin.organization_id, expected.organization_id),
    bindingMismatch("run_id", origin.run_id, expected.run_id),
    bindingMismatch("step_index", origin.step_index, expected.step_index),
    bindingMismatch("gate_cycle", origin.gate_cycle, expected.gate_cycle ?? 0),
    bindingMismatch("decision", origin.decision, expected.decision),
    bindingMismatch("decision_basis", origin.decision_basis, expected.decision_basis),
    bindingMismatch("decision_id", origin.decision_id, expected.decision_id),
    bindingMismatch("approver_display", origin.approver_display, expected.approver_display),
  ];
  if (expected.decided_at === undefined || !sameInstant(origin.decided_at, expected.decided_at)) {
    checks.push({ ok: false, reason: "binding_mismatch:decided_at" });
  }
  if (
    expected.authority_subject_id !== undefined &&
    origin.authority_subject_id !== expected.authority_subject_id
  ) {
    checks.push({ ok: false, reason: "binding_mismatch:authority_subject_id" });
  }
  for (const check of checks) {
    if (check !== null) return check;
  }

  const expectedRelation = expected.decision_relation ?? null;
  if (origin.decision_relation !== expectedRelation) {
    return { ok: false, reason: "binding_mismatch:decision_relation" };
  }
  try {
    if (
      canonicalModelPositions(origin.model_positions) !==
      canonicalModelPositions(expected.model_positions ?? [])
    ) {
      return { ok: false, reason: "binding_mismatch:model_positions" };
    }
    if (
      canonicalizeJson([...origin.resolving_evidence_ids].sort()) !==
      canonicalizeJson([...(expected.resolving_evidence_ids ?? [])].sort())
    ) {
      return { ok: false, reason: "binding_mismatch:resolving_evidence_ids" };
    }
  } catch {
    return { ok: false, reason: "malformed_assertion" };
  }
  return { ok: true, assertion };
}

export function verifyDecisionOriginAuthorityAssertionV2(
  raw: unknown,
  trust: PortalAuthorityTrust,
  expected: ExpectedAuthorityBinding,
): DecisionOriginAuthorityVerificationResult {
  const parsed = parseDecisionOriginAuthorityAssertionV2(raw);
  if (!parsed.ok) return { ok: false, reason: "malformed_assertion" };
  return verifyV2(parsed.assertion, trust, expected);
}

export function verifyRetirementAuthorityAssertionV3(
  raw: unknown,
  trust: PortalAuthorityTrust,
  expected: ExpectedAuthorityBinding,
  readback: {
    readonly storeDir: string;
    readonly artifactId: string;
    readonly readEnvelopeById: MappedRetirementEnvelopeReader;
  },
): RetirementAuthorityVerificationResult {
  const parsed = parseRetirementAuthorityAssertionV3(raw);
  if (!parsed.ok) return { ok: false, reason: "malformed_assertion" };
  const assertion = parsed.assertion;
  const origin = assertion.payload.decision_origin;
  const pinned = trust.keys.get(assertion.payload.key_id);
  if (pinned === undefined) return { ok: false, reason: "unknown_key_id" };
  if (assertion.signature.public_key !== pinned) {
    return { ok: false, reason: "embedded_key_mismatch" };
  }
  const originCanonical = canonicalizeJson(origin);
  const originHash = createHash("sha256").update(originCanonical, "utf8").digest("hex");
  if (originHash !== assertion.payload.decision_origin_hash) {
    return { ok: false, reason: "binding_mismatch:decision_origin_hash" };
  }
  try {
    const valid = ed25519Verify(
      null,
      Buffer.from(canonicalizeJson(assertion.payload), "utf8"),
      createPublicKey({ key: Buffer.from(pinned, "base64"), format: "der", type: "spki" }),
      Buffer.from(assertion.signature.signature, "base64"),
    );
    if (!valid) return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }
  const scalarChecks = [
    bindingMismatch("organization_id", origin.organization_id, expected.organization_id),
    bindingMismatch("run_id", origin.run_id, expected.run_id),
    bindingMismatch("step_index", origin.step_index, expected.step_index),
    bindingMismatch("gate_cycle", origin.gate_cycle, expected.gate_cycle ?? 0),
    bindingMismatch("decision", origin.decision, expected.decision),
    bindingMismatch("decision_basis", origin.decision_basis, expected.decision_basis),
    bindingMismatch("decision_id", origin.decision_id, expected.decision_id),
    bindingMismatch("approver_display", origin.approver_display, expected.approver_display),
    bindingMismatch(
      "decision_relation",
      origin.decision_relation,
      expected.decision_relation,
    ),
  ];
  for (const check of scalarChecks) if (check !== null) return check;
  if (expected.decided_at === undefined || !sameInstant(origin.decided_at, expected.decided_at)) {
    return { ok: false, reason: "binding_mismatch:decided_at" };
  }
  const expectedRelations = expected.retirement_basis_relations;
  if (
    expectedRelations === undefined ||
    canonicalRetirementRelations(origin.retirement_basis_relations) !==
      canonicalRetirementRelations(expectedRelations)
  ) {
    return { ok: false, reason: "binding_mismatch:retirement_basis_relations" };
  }
  for (const relation of origin.retirement_basis_relations) {
    const validated = validateMappedRetirementEnvelopePair({
      storeDir: readback.storeDir,
      relation,
      artifactId: readback.artifactId,
      readEnvelopeById: readback.readEnvelopeById,
    });
    if (!validated.ok) return { ok: false, reason: validated.code };
  }
  return { ok: true, assertion };
}

/**
 * Verify an untrusted assertion against the pinned trust anchor and the exact
 * expected binding. Fail-closed on every axis.
 */
export function verifyAuthorityAssertion(
  raw: unknown,
  trust: PortalAuthorityTrust,
  expected: ExpectedAuthorityBinding,
): AuthorityVerificationResult {
  const parsed = parseAuthorityAssertion(raw);
  if (!parsed.ok) return { ok: false, reason: "malformed_assertion" };
  const { assertion } = parsed;
  const { payload } = assertion;

  if (payload.version !== AUTHORITY_ASSERTION_SCHEMA || assertion.schema !== AUTHORITY_ASSERTION_SCHEMA) {
    return { ok: false, reason: "schema_mismatch" };
  }

  // Authenticity half — pinned key only. The key_id selects the pinned entry;
  // the embedded public key must merely EQUAL it (diagnostic consistency).
  const pinned = trust.keys.get(payload.key_id);
  if (pinned === undefined) return { ok: false, reason: "unknown_key_id" };
  if (assertion.signature.public_key !== pinned) {
    return { ok: false, reason: "embedded_key_mismatch" };
  }

  let canonical: string;
  try {
    canonical = canonicalizeJson(payload);
  } catch {
    return { ok: false, reason: "malformed_assertion" };
  }

  let valid = false;
  try {
    valid = ed25519Verify(
      null,
      Buffer.from(canonical, "utf8"),
      createPublicKey({ key: Buffer.from(pinned, "base64"), format: "der", type: "spki" }),
      Buffer.from(assertion.signature.signature, "base64"),
    );
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }
  if (!valid) return { ok: false, reason: "invalid_signature" };

  // Binding half — the signed decision must be for THIS gate, THIS org, THIS
  // decision, THIS basis. Anything else is replay/misbinding and fails closed.
  const checks: (AuthorityVerificationResult | null)[] = [
    bindingMismatch("organization_id", payload.organization_id, expected.organization_id),
    bindingMismatch("run_id", payload.run_id, expected.run_id),
    bindingMismatch("thread_id", payload.thread_id, expected.thread_id),
    bindingMismatch("step_index", payload.step_index, expected.step_index),
    bindingMismatch("decision", payload.decision, expected.decision),
    bindingMismatch("decision_basis", payload.decision_basis, expected.decision_basis),
  ];
  if (expected.decided_at !== undefined) {
    checks.push(bindingMismatch("decided_at", payload.decided_at, expected.decided_at));
  }
  if (expected.authority_subject_id !== undefined) {
    checks.push(
      bindingMismatch("authority_subject_id", payload.authority_subject_id, expected.authority_subject_id),
    );
  }
  if (expected.approver_display !== undefined) {
    checks.push(
      bindingMismatch("approver_display", payload.approver_display, expected.approver_display),
    );
  }
  if (expected.decision_id !== undefined) {
    checks.push(bindingMismatch("decision_id", payload.decision_id, expected.decision_id));
  }
  for (const check of checks) {
    if (check !== null) return check;
  }

  // P3 Phase 2 / P5 V1 (additive): relation binding. Both directions fail closed.
  // proceed_despite and retire_model_position are distinct — one cannot
  // satisfy the other. Retirement additionally binds resolving_evidence_ids.
  const expectedRelation = expected.decision_relation;
  const expectedPositions = expected.model_positions;
  const expectsRelation =
    expectedRelation !== undefined ||
    (expectedPositions !== undefined && expectedPositions.length > 0);
  const carriesRelation =
    payload.decision_relation !== undefined || payload.model_positions !== undefined;

  if (expectsRelation) {
    if (payload.decision_relation === undefined) {
      return { ok: false, reason: "binding_mismatch:decision_relation" };
    }
    if (expectedRelation !== undefined && payload.decision_relation !== expectedRelation) {
      return { ok: false, reason: "binding_mismatch:decision_relation" };
    }
    const expectedMps = expectedPositions ?? [];
    const payloadMps = payload.model_positions ?? [];
    if (payloadMps.length === 0) {
      return { ok: false, reason: "binding_mismatch:model_positions" };
    }
    try {
      if (canonicalModelPositions(payloadMps) !== canonicalModelPositions(expectedMps)) {
        return { ok: false, reason: "binding_mismatch:model_positions" };
      }
    } catch {
      return { ok: false, reason: "binding_mismatch:model_positions" };
    }
    if (payload.decision_relation === AUTHORITY_DECISION_RELATION_RETIREMENT) {
      const expectedEv = [...(expected.resolving_evidence_ids ?? [])].sort();
      const payloadEv = [...(payload.resolving_evidence_ids ?? [])].sort();
      if (payloadEv.length === 0) {
        return { ok: false, reason: "binding_mismatch:resolving_evidence_ids" };
      }
      if (canonicalizeJson(payloadEv) !== canonicalizeJson(expectedEv)) {
        return { ok: false, reason: "binding_mismatch:resolving_evidence_ids" };
      }
    } else if (payload.resolving_evidence_ids !== undefined) {
      return { ok: false, reason: "binding_mismatch:resolving_evidence_ids" };
    }
  } else if (carriesRelation) {
    return { ok: false, reason: "binding_mismatch:decision_relation" };
  }

  return { ok: true, assertion };
}
