/**
 * Truth Arbitration stage adapter — spine port v1.
 *
 * Resolves competing truth claims arising from the prior accumulator and
 * preserves first-class UNKNOWNs rather than collapsing them.
 *
 * ── Architecture reference ─────────────────────────────────────────────────────
 *
 *   docs/architecture/USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md, Section 2:
 *   "Truth Arbitration → resolve contradictions, certify confidence, preserve UNKNOWN"
 *
 * ── Key v1 guardrail (structurally encoded) ────────────────────────────────────
 *
 *   "Automatic feedback never bypasses Truth Arbitration. Prior observation is
 *   a CLAIM to be arbitrated, not a truth." (canonical architecture doc, Section 4)
 *
 *   Structural enforcement (file:line):
 *     truth-arbitration.ts, buildConflictClaims() (~line 86):
 *     When ctx.prior.decisionBasis is connected AND its evidence sub-section
 *     status is "derived" (meaning a prior observation was fed as evidence),
 *     a conflict-claim string is recorded that reads:
 *       "prior observation fed as Decision Basis evidence is an unarbitrated
 *        CLAIM, not certified truth"
 *     This makes the guardrail structurally encoded — it is not a comment, it
 *     is a data item that WILL appear in the arbitration record whenever a prior
 *     observation enters the pipeline as evidence.
 *
 * ── certifiedConfidence: the deterministic certifier (L3.S3, Lane 3) ───────────
 *
 *   `certifiedConfidence` is COMPUTED from the Decision Basis — never guessed.
 *   The number is a DEFINED verification-coverage ratio, not a probability of
 *   correctness: verifiedBasisInputs / 3 over the three sensor-backed basis
 *   sub-sections (evidence connected via the pre-state sensor; policy connected
 *   AND cleared by the constraint authority; sourceOfRecord connected via the
 *   git sensor). The resolution text states the computation verbatim.
 *
 *   Fail-closed gates — ALL of these keep the honest literal "unknown":
 *     - any unarbitrated conflict claim (e.g. a prior-observation loop input);
 *     - certification level is not "certified_by_source" (the core/k1 authority
 *       grading refused: unverified claims, human-judgment top, or no anchor);
 *     - the constraint authority returned a conflict_detected clearance
 *       (confidence is NEVER certified for a policy-violating proposal);
 *     - zero verified basis inputs (thin basis — nothing to certify from).
 *
 *   The certifier never manufactures confidence: every emitted number is a
 *   ratio over real, connected sections, and the gates above degrade to
 *   "unknown" rather than inventing a value. No LLM is involved anywhere in
 *   this stage.
 *
 * ── certification: core/k1 authority model wired into the live path (Phase C) ───
 *
 *   The architecture doc (Section 3) previously noted Truth Arbitration "exists in
 *   core/k1/, 0 imports from live path". The Phase C "Certify" slice closes that
 *   gap: this stage now imports core/k1's PURE authority ranking (AUTHORITY_RANK)
 *   and applies its `arbitrateConflict` semantics DETERMINISTICALLY to populate a
 *   new `certification` field — a discrete, evidence-anchored classification
 *   (certified_by_source / requires_human_review / uncertified) derived only from
 *   connected record sections. It is NOT a fabricated score; it is distinct from
 *   `certifiedConfidence`. k1's `arbitrateConflict` itself is NOT called because it
 *   mints a UUID + timestamp, which would break record-hash determinism.
 *
 * ── Gauge law ──────────────────────────────────────────────────────────────────
 *
 *   "connected"   → wired to a real runtime source.
 *   "derived"     → explicitly computed from one or more connected sections.
 *   "unavailable" → no input to arbitrate; stated honestly.
 *   (invented is unrepresentable in the type system)
 *
 * ── Evidence boundary (Rule 13) ────────────────────────────────────────────────
 *
 *   This file does NOT import from src/evidence/. The authority path must remain
 *   structurally blind to the evidence observer (verify-rules.sh Rule 13 + the
 *   portable tests/governed-decision/evidence-boundary.test.ts guard).
 *
 * ── Never throws ───────────────────────────────────────────────────────────────
 *
 *   Unexpected errors are wrapped and degrade the section to unavailable.
 */

import type {
  DecisionSection,
  StageName,
  TruthArbitrationPayload,
  DecisionBasisPayload,
  Certification,
  CertificationReason,
  CertificationLevel,
  ReferenceEdge,
} from "../types.js";
import type { BaseStageContext } from "../pipeline.js";
// Phase C "Certify" slice: wire core/k1's authority model into the live decision
// flow. Per the canonical architecture doc (Section 3) Truth Arbitration "exists
// in core/k1/, 0 imports from live path"; this is that first wiring. Only the
// PURE authority ranking is imported -- `arbitrateConflict` itself is NOT used
// because it mints a crypto.randomUUID + Date (non-deterministic), which would
// break the GovernedDecisionRecord's content-hash determinism. The deterministic
// certification mapping below applies k1's authority semantics without that.
import { AUTHORITY_RANK } from "../../../core/k1/authority.js";
import type { AuthorityLevel } from "../../../core/k1/types.js";

// ─── conflict claim detection ──────────────────────────────────────────────────

/**
 * Derive the deterministic conflict-claim list from what is available in the
 * prior accumulator.
 *
 * KEY v1 behavior — the guardrail claim (file:line anchor for AGENTS.md):
 *
 *   When ctx.prior.decisionBasis is connected AND its evidence sub-section has
 *   status "derived" (i.e. a prior observation was fed into the basis via the
 *   automatic loop), we record:
 *
 *     "prior observation fed as Decision Basis evidence is an unarbitrated
 *      CLAIM, not certified truth"
 *
 *   This structurally encodes the canonical architecture guardrail:
 *   "Prior observation is a claim to be arbitrated, not a truth."
 *   The claim appears in the record — it is not discarded, and it is not
 *   silently resolved. Future slices may certify or refute it; v1 preserves it.
 *
 * Additional conflicts may be added here in future Phase C slices as more
 * sensors are wired. In v1, no other competing claims are detectable
 * deterministically, so only the prior-observation-as-claim is emitted when
 * the evidence loop is active.
 */
function buildConflictClaims(
  decisionBasis: DecisionSection<DecisionBasisPayload> | undefined,
): readonly string[] {
  const claims: string[] = [];

  if (decisionBasis !== undefined && decisionBasis.status === "connected") {
    const { evidence } = decisionBasis.value;
    if (evidence.status === "derived") {
      // Guardrail: a prior observation entered the pipeline as Decision Basis
      // evidence. That observation has not been independently certified — it is
      // a claim, not established truth. Record this explicitly so the record
      // carries the tension rather than silently treating the loop input as
      // authoritative.
      claims.push(
        "prior observation fed as Decision Basis evidence is an unarbitrated CLAIM, not certified truth",
      );
    }
    // evidence.status === "unavailable": no prior observation was fed; no
    // prior-observation claim to register.
  }

  return claims;
}

/**
 * Build an honest resolution statement.
 *
 * When there are unresolved claims: acknowledges them by count, then appends the
 * certifier's confidence note (always an "unknown" note in that case — the
 * conflict gate fails closed).
 *
 * When there are no claims: states no competing truth claims were detected, then
 * appends the certifier's confidence note — either the verbatim computation
 * ("confidence X certified from N of 3 verified basis inputs (...)") or the
 * honest reason confidence stayed unknown.
 */
function buildResolution(conflicts: readonly string[], confidenceNote: string): string {
  if (conflicts.length > 0) {
    return `preserved ${conflicts.length} unarbitrated claim(s); ${confidenceNote}`;
  }
  return `no competing truth claims detected; ${confidenceNote}`;
}

// ─── confidence certifier (L3.S3 — Lane 3, Certify slice) ──────────────────────

/**
 * The certifier's outcome: the confidence value plus the human-readable note
 * that states EXACTLY how it was computed (or exactly why it stayed unknown).
 * The two are produced together so the record can never carry a number whose
 * derivation is not stated.
 */
type ConfidenceOutcome = {
  readonly confidence: number | "unknown";
  readonly note: string;
};

/**
 * Read the policy sub-section's clearance status defensively. Returns:
 *   "cleared" / "conflict_detected" — the constraint authority's verbatim verdict;
 *   null — policy not connected, or connected with no clearance (no proposal was
 *   evaluated, so no verdict exists — gauge law).
 */
function policyClearanceStatus(
  policy: DecisionSection<unknown>,
): "cleared" | "conflict_detected" | null {
  if (policy.status !== "connected") return null;
  const value = policy.value as { clearance?: { status?: unknown } };
  const status = value?.clearance?.status;
  return status === "cleared" || status === "conflict_detected" ? status : null;
}

/**
 * Compute `certifiedConfidence` deterministically from the Decision Basis.
 *
 * The emitted number is a DEFINED verification-coverage ratio over the three
 * sensor-backed basis sub-sections — never a probability estimate:
 *
 *   verified inputs (each contributes 1/3):
 *     evidence       connected  (workspace pre-state sensed — L3.S1)
 *     policy         connected AND clearance "cleared" (constraint authority — L3.S2)
 *     sourceOfRecord connected  (git provenance sensor)
 *
 * Fail-closed gates (each keeps the literal "unknown" — confidence is never
 * manufactured):
 *   1. conflicts present            — unarbitrated claims cannot underwrite a
 *                                     certified number.
 *   2. certification.level is not   — the core/k1 authority grading refused
 *      "certified_by_source"          (unverified claim, human-judgment top, or
 *                                     no verified anchor). Confidence rides on
 *                                     the SAME authority model, never above it.
 *   3. policy conflict_detected     — the constraint authority found the proposal
 *                                     violating; certifying confidence for it
 *                                     would launder the violation.
 *   4. zero verified inputs         — a thin basis has nothing to certify from.
 *
 * Deterministic: same basis → same number (2-decimal rounding keeps the record
 * hash stable across platforms). Pure: reads the sections, touches nothing.
 */
function deriveCertifiedConfidence(
  decisionBasis: DecisionSection<DecisionBasisPayload> | undefined,
  conflicts: readonly string[],
  certification: Certification,
): ConfidenceOutcome {
  if (conflicts.length > 0) {
    return {
      confidence: "unknown",
      note: "confidence remains unknown (unarbitrated claims present)",
    };
  }
  if (certification.level !== "certified_by_source") {
    return {
      confidence: "unknown",
      note: "confidence remains unknown (basis does not rest on a verified source of record)",
    };
  }
  // certified_by_source implies a connected decisionBasis (the source-of-record
  // claim can only come from one), but read defensively — never assume.
  if (decisionBasis === undefined || decisionBasis.status !== "connected") {
    return {
      confidence: "unknown",
      note: "confidence remains unknown (no connected decision basis to certify from)",
    };
  }

  const basis = decisionBasis.value;
  const clearance = policyClearanceStatus(basis.policy);
  if (clearance === "conflict_detected") {
    return {
      confidence: "unknown",
      note: "confidence remains unknown (constraint authority detected a policy conflict)",
    };
  }

  const verified: string[] = [];
  if (basis.evidence.status === "connected") verified.push("evidence");
  if (clearance === "cleared") verified.push("policy");
  if (basis.sourceOfRecord.status === "connected") verified.push("source of record");

  if (verified.length === 0) {
    return {
      confidence: "unknown",
      note: "confidence remains unknown (no verified basis inputs — basis too thin to certify)",
    };
  }

  const confidence = Math.round((verified.length / 3) * 100) / 100;
  return {
    confidence,
    note:
      `confidence ${confidence} certified from ${verified.length} of 3 ` +
      `verified basis inputs (${verified.join(", ")})`,
  };
}

// ─── certification (core/k1 authority model, wired into the live path) ──────────

/**
 * Build the authority-ranked claims that feed certification, reading ONLY
 * connected/derived record sections (gauge law: a claim exists only when its
 * source section is real). Authority levels use core/k1's vocabulary.
 *
 *   sourceOfRecord connected (git) -> source_of_record (the canonical authority)
 *   human constraints (non-empty)  -> human_judgment
 *   evidence derived (loop input)  -> unverified (an unarbitrated prior claim)
 *   the decision's own plan        -> agent_inference (lowest; always present
 *                                     because the caller only certifies when
 *                                     understanding is connected)
 *
 * runtimeState is deliberately NOT a claim: node version/platform is incidental
 * process metadata, not a truth claim about the decision (and being always-connected
 * it would make every decision trivially "verified"). policy is unavailable in v1.
 *
 * Explicit Invocation Lineage (INV-EIL-3/5, S1b): each DECLARED reference threaded
 * into the basis enters as a claim at its KERNEL-ASSIGNED authority band -- never
 * inherited, never self-certified. The reference is re-arbitrated here like any
 * other claim. A `prior_observation` edge is skipped ONLY when the evidence
 * sub-section already represented it (the --from loop), to avoid double-counting
 * the same input; an explicitly declared `prior_observation` reference with no
 * active loop evidence is still graded.
 */
function buildCertificationClaims(
  decisionBasis: DecisionSection<DecisionBasisPayload> | undefined,
): readonly CertificationReason[] {
  const claims: CertificationReason[] = [];

  if (decisionBasis !== undefined && decisionBasis.status === "connected") {
    const basis = decisionBasis.value;
    if (basis.sourceOfRecord.status === "connected") {
      claims.push({ basis: "source of record (repository state)", authorityLevel: "source_of_record" });
    }
    if (basis.constraints.status === "connected") {
      const c = basis.constraints.value as { constraints?: unknown };
      if (Array.isArray(c.constraints) && c.constraints.length > 0) {
        claims.push({ basis: "human-supplied constraints", authorityLevel: "human_judgment" });
      }
    }
    const evidenceDerived = basis.evidence.status === "derived";
    if (evidenceDerived) {
      claims.push({
        basis: "prior observation fed as evidence (automatic loop)",
        authorityLevel: "unverified",
      });
    }
    // Declared reference claims (S1b). Defensive read: records persisted before
    // S1b omit `references` -- treat absence as [] (gauge law), never fabricate.
    const references: readonly ReferenceEdge[] = Array.isArray(basis.references)
      ? basis.references
      : [];
    for (const edge of references) {
      // Skip a prior_observation edge already counted via the derived-evidence
      // claim above; otherwise grade it (an explicit reference without loop input).
      if (edge.kind === "prior_observation" && evidenceDerived) {
        continue;
      }
      claims.push({
        basis: `declared reference (${edge.kind}): ${edge.ref}`,
        authorityLevel: edge.authorityBand,
      });
    }
  }

  // The decision itself is a model proposal: the lowest-authority claim, always
  // present (the caller guarantees a connected understanding before certifying).
  claims.push({ basis: "model candidate plan", authorityLevel: "agent_inference" });

  return claims;
}

/**
 * Derive the certification level from the claims' authorities + the conflict set,
 * applying core/k1's `arbitrateConflict` semantics deterministically (no UUID, no
 * timestamp -- those would break record-hash determinism):
 *
 *   - any unverified/unarbitrated conflict present -> requires_human_review
 *   - else ANY claim is `unverified` (e.g. an `asserted_artifact` reference, or a
 *     `verified_artifact` the kernel could not re-verify in THIS invocation) ->
 *     requires_human_review. Per the EIL charter (S4): "an unverified reference
 *     present -> requires_human_review". A declared dependency the kernel cannot
 *     stand behind forces human adjudication EVEN WHEN a source anchor exists --
 *     unverified trust is never silently absorbed into `certified_by_source`.
 *   - else top authority is source_of_record / verified_system_state -> certified_by_source
 *   - else top authority is human_judgment -> requires_human_review (k1: "human
 *     judgment present - requires explicit review for truth")
 *   - else (agent_inference / none) -> uncertified
 *
 * `reasons` is the full claim list so the certification is fully inspectable;
 * every reason cites a real connected section.
 */
function deriveCertification(
  claims: readonly CertificationReason[],
  conflicts: readonly string[],
): Certification {
  const top = claims.reduce<CertificationReason | null>(
    (best, c) =>
      best === null || AUTHORITY_RANK[c.authorityLevel] > AUTHORITY_RANK[best.authorityLevel]
        ? c
        : best,
    null,
  );
  const topLevel: AuthorityLevel | null = top !== null ? top.authorityLevel : null;
  const hasUnverifiedClaim = claims.some((c) => c.authorityLevel === "unverified");

  let level: CertificationLevel;
  if (conflicts.length > 0) {
    level = "requires_human_review";
  } else if (hasUnverifiedClaim) {
    level = "requires_human_review";
  } else if (topLevel === "source_of_record" || topLevel === "verified_system_state") {
    level = "certified_by_source";
  } else if (topLevel === "human_judgment") {
    level = "requires_human_review";
  } else {
    level = "uncertified";
  }

  return { level, reasons: claims };
}

// ─── public port ──────────────────────────────────────────────────────────────

/**
 * Run the Truth Arbitration stage and return a gauge-tagged
 * `DecisionSection<TruthArbitrationPayload>` for the governed-decision spine.
 *
 * Unavailable: when understanding is absent or not connected — there is no
 *   understood intent to arbitrate over. Without a connected understanding,
 *   arbitration would be operating on nothing.
 *
 * Derived: understanding is connected. Derivation pulls from "understanding"
 *   always, and from "decisionBasis" when that section exists in the prior
 *   accumulator.
 *
 *   Payload:
 *     preservedUnknowns  — forwarded verbatim from understanding.value.unknowns;
 *                          first-class UNKNOWNs are never collapsed.
 *     conflicts          — deterministic list of unarbitrated claims detected
 *                          from the prior accumulator (see buildConflictClaims).
 *     certifiedConfidence — computed by the deterministic confidence certifier
 *                          (L3.S3): a verification-coverage ratio over the
 *                          sensor-backed basis inputs, or the honest literal
 *                          "unknown" when any fail-closed gate fires (conflicts,
 *                          non-source-certified authority, policy conflict,
 *                          thin basis). Never fabricated.
 *     resolution         — honest textual statement describing the arbitration
 *                          outcome, including the verbatim confidence derivation
 *                          (or the exact reason confidence stayed unknown).
 *
 * Never throws. Unexpected errors degrade the section to unavailable.
 */
export async function buildTruthArbitrationSection(
  ctx: BaseStageContext,
): Promise<DecisionSection<TruthArbitrationPayload>> {
  try {
    const understanding = ctx.prior.understanding;

    // Guard: without a connected understanding there is no safe truth to arbitrate.
    if (understanding === undefined || understanding.status !== "connected") {
      return {
        status: "unavailable",
        reason: "nothing to arbitrate: intent not understood",
      };
    }

    const decisionBasis = ctx.prior.decisionBasis;

    // derivedFrom always includes "understanding" (the primary input).
    // Include "decisionBasis" ONLY when it actually contributed — i.e. it is
    // connected and its value was read by buildConflictClaims(). An unwired or
    // unavailable decisionBasis is never read, so claiming derivation from it
    // would misstate provenance on the canonical record.
    const basisContributed =
      decisionBasis !== undefined && decisionBasis.status === "connected";
    const derivedFrom: readonly StageName[] = [
      "understanding",
      ...(basisContributed ? ["decisionBasis" as const] : []),
    ] as const;

    const preservedUnknowns: readonly string[] = [...understanding.value.unknowns];

    const conflicts = buildConflictClaims(decisionBasis);

    // Certification: the evidence-anchored, deterministic application of core/k1's
    // authority model. Classifies the AUTHORITY the basis rests on; also gates the
    // confidence certifier below (confidence never outranks the authority grading).
    const certification = deriveCertification(buildCertificationClaims(decisionBasis), conflicts);

    // Confidence certifier (L3.S3): a deterministic verification-coverage ratio
    // computed from the basis, or the honest literal "unknown" when any
    // fail-closed gate fires. The note states the derivation verbatim and is
    // carried into the resolution so the record explains its own number.
    const { confidence: certifiedConfidence, note: confidenceNote } =
      deriveCertifiedConfidence(decisionBasis, conflicts, certification);

    const resolution = buildResolution(conflicts, confidenceNote);

    const value: TruthArbitrationPayload = {
      conflicts,
      resolution,
      certifiedConfidence,
      certification,
      preservedUnknowns,
    };

    return {
      status: "derived",
      value,
      derivedFrom,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      reason: `truth arbitration stage failed unexpectedly: ${message}`,
    };
  }
}

/**
 * Convenience alias so the adapter can be passed directly as
 * `ports.truthArbitration` in a `runGovernedDecisionSpine()` call.
 */
export const truthArbitrationPort = buildTruthArbitrationSection;
