/**
 * Epistemic Objects — an inspectable product-object view over a record.
 *
 * Canonical amendment: USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md, Amendment
 * v1.1 (ratified founder + CTO, 2026-06-29).
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 *
 *   "UseSteady does not ask users to trust AI reasoning. It turns AI reasoning
 *   into inspectable product objects: Inference, Hypothesis, Prediction, Outcome.
 *   Only Outcome can close the loop against reality."
 *
 *   This module is a PURE READ-SIDE CLASSIFICATION of an existing
 *   GovernedDecisionRecord. It adds NO pipeline stage, NO authority, and invents
 *   NOTHING. Like projection.ts, its only import is ./types.js; it reads the
 *   record and nothing else. Where a source does not exist yet (Prediction) or
 *   reality was not observed (Outcome with no probe), the object is honestly
 *   UNKNOWN — "UNKNOWN is earned."
 *
 * ── The certification rule (locked) ──────────────────────────────────────────
 *
 *   Inference, Hypothesis and Prediction are reasoning objects: they NEVER carry
 *   REALITY_OBSERVED. Only Outcome can. This is enforced structurally below (each
 *   kind has a fixed status ceiling) and guarded by tests.
 */

import type {
  DecisionSection,
  GovernedDecisionRecord,
  StageName,
  TruthArbitrationPayload,
} from "./types.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EpistemicKind = "inference" | "hypothesis" | "prediction" | "outcome";

export type EpistemicStatus =
  | "DERIVED_NOT_CERTIFIED" // inference  — derived from evidence, not certified
  | "CANDIDATE_ONLY" // hypothesis — a candidate explanation
  | "PROJECTED_NOT_OBSERVED" // prediction — a projected future, not observed
  | "REALITY_OBSERVED" // outcome    — what actually happened (reality verified)
  | "UNKNOWN"; // earned: no source wired / reality not observed yet

export const CERTIFICATION_RULE =
  "Inference, Hypothesis, and Prediction are reasoning objects. They do not create truth. Only Outcome can close the loop against reality.";

export type EpistemicObject = {
  readonly kind: EpistemicKind;
  readonly status: EpistemicStatus;
  /**
   * A human-readable statement DERIVED ONLY from the record. Absent when there
   * is no source text to derive it from (status UNKNOWN, or a malformed/empty
   * payload) — never fabricated.
   */
  readonly statement?: string;
  /** Which record stage(s) this object was derived from. */
  readonly derivedFrom: readonly StageName[];
};

/**
 * The non-UNKNOWN status each kind is permitted to carry. This is the
 * machine-checkable form of the certification rule: only `outcome` may reach
 * REALITY_OBSERVED; reasoning kinds cannot.
 */
export const KIND_CEILING: Readonly<Record<EpistemicKind, EpistemicStatus>> = {
  inference: "DERIVED_NOT_CERTIFIED",
  hypothesis: "CANDIDATE_ONLY",
  prediction: "PROJECTED_NOT_OBSERVED",
  outcome: "REALITY_OBSERVED",
};

// ─── Defensive section reader ──────────────────────────────────────────────────

/**
 * Read a section's status defensively (a persisted/foreign record could be any
 * shape). Mirrors projection.ts: never throw on a malformed record.
 */
function sectionStatus(section: unknown): "connected" | "derived" | "unavailable" | "other" {
  if (section === null || typeof section !== "object") return "other";
  const s = (section as { status?: unknown }).status;
  if (s === "connected" || s === "derived" || s === "unavailable") return s;
  return "other";
}

// ─── Per-kind classifiers (each reads ONLY the record) ─────────────────────────

/**
 * Inference = what the current reasoning suggests, DERIVED_NOT_CERTIFIED.
 *
 * The kernel's inference engine is Truth Arbitration: it DERIVES a resolution
 * from understanding (and, when present, basis evidence). Per Amendment A1.3 the
 * DERIVED_NOT_CERTIFIED status is DEFINED by Truth Arbitration refusing to
 * certify — i.e. `certifiedConfidence === "unknown"` (its only v1 value). We gate
 * on that literal: if a future certifier ever sets a numeric confidence, the
 * conclusion is certified and is NO LONGER a derived-not-certified inference, so
 * we honestly decline to assert that status (the enum has no CERTIFIED member).
 *
 * The statement is the kernel's own derived `resolution` text (not a fixed
 * string), so users inspect the actual derived conclusion. Provenance includes
 * `decisionBasis` only when a real evidence sub-section is present (e.g. a prior
 * observation fed the basis). UNKNOWN when there is no derivation or the section
 * is malformed.
 */
function classifyInference(record: GovernedDecisionRecord): EpistemicObject {
  const ta = record.truthArbitration as DecisionSection<TruthArbitrationPayload> | undefined;
  const taStatus = sectionStatus(ta);
  if (taStatus !== "derived" && taStatus !== "connected") {
    return { kind: "inference", status: "UNKNOWN", derivedFrom: [] };
  }
  const taValue = (ta as { value?: unknown }).value;
  if (taValue === null || typeof taValue !== "object") {
    return { kind: "inference", status: "UNKNOWN", derivedFrom: [] };
  }

  // DERIVED_NOT_CERTIFIED is defined by the certifier refusing to certify.
  const certifiedConfidence = (taValue as { certifiedConfidence?: unknown }).certifiedConfidence;
  if (certifiedConfidence !== "unknown") {
    return { kind: "inference", status: "UNKNOWN", derivedFrom: [] };
  }

  // Enrich provenance with decisionBasis ONLY when its evidence sub-section is
  // actually present (connected/derived) — never claim evidence we don't have.
  const derivedFrom: StageName[] = [];
  const basis = record.decisionBasis;
  if (sectionStatus(basis) === "connected") {
    const basisValue = (basis as { value?: unknown }).value;
    if (basisValue !== null && typeof basisValue === "object") {
      const evStatus = sectionStatus((basisValue as { evidence?: unknown }).evidence);
      if (evStatus === "connected" || evStatus === "derived") {
        derivedFrom.push("decisionBasis");
      }
    }
  }
  derivedFrom.push("truthArbitration");

  // The status is structural (certifiedConfidence === "unknown"), so it holds
  // regardless of display text. The statement is the kernel's OWN derived
  // resolution — never fabricated: if it is missing/empty we omit the statement
  // rather than invent one (gauge-law consistent with projection.ts).
  const resolution = (taValue as { resolution?: unknown }).resolution;
  const base = {
    kind: "inference",
    status: "DERIVED_NOT_CERTIFIED",
    derivedFrom,
  } as const;
  return typeof resolution === "string" && resolution.length > 0
    ? { ...base, statement: resolution }
    : base;
}

/**
 * Hypothesis = a candidate explanation, CANDIDATE_ONLY.
 * Sourced from understanding.candidatePlans. UNKNOWN when understanding is not
 * connected or carries no candidates.
 */
function classifyHypothesis(record: GovernedDecisionRecord): EpistemicObject {
  const understanding = record.understanding;
  const uStatus = sectionStatus(understanding);
  if (uStatus !== "connected" && uStatus !== "derived") {
    return { kind: "hypothesis", status: "UNKNOWN", derivedFrom: [] };
  }
  const value = (understanding as { value?: unknown }).value;
  const plansRaw =
    value !== null && typeof value === "object"
      ? (value as { candidatePlans?: unknown }).candidatePlans
      : undefined;
  const plans = Array.isArray(plansRaw) ? plansRaw : [];
  if (plans.length === 0) {
    return { kind: "hypothesis", status: "UNKNOWN", derivedFrom: [] };
  }

  // CANDIDATE_ONLY is structural (candidates exist). The statement is the
  // record's OWN candidate summaries, verbatim — never fabricated prose. If no
  // plan carries a usable summary, omit the statement (gauge-law consistent).
  const summaries = plans
    .map((p) =>
      p !== null && typeof p === "object" && typeof (p as { summary?: unknown }).summary === "string"
        ? ((p as { summary: string }).summary)
        : "",
    )
    .filter((s) => s.length > 0);
  const base = {
    kind: "hypothesis",
    status: "CANDIDATE_ONLY",
    derivedFrom: ["understanding"],
  } as const;
  return summaries.length > 0 ? { ...base, statement: summaries.join("; ") } : base;
}

/**
 * Prediction = what may happen next, PROJECTED_NOT_OBSERVED.
 * The kernel produces NO prediction object in v1, so this is honestly UNKNOWN —
 * never fabricated. When a real projection source is wired, this classifier gains
 * a source; until then "UNKNOWN is earned."
 */
function classifyPrediction(_record: GovernedDecisionRecord): EpistemicObject {
  return { kind: "prediction", status: "UNKNOWN", derivedFrom: [] };
}

/**
 * Outcome = what actually happened, REALITY_OBSERVED.
 * Sourced from observation, and ONLY when a RealityProbe verified reality
 * (realityVerdict !== "unknown"). Observing our own execution is not observing
 * reality — without a probe the outcome is honestly UNKNOWN.
 */
function classifyOutcome(record: GovernedDecisionRecord): EpistemicObject {
  const observation = record.observation;
  const oStatus = sectionStatus(observation);
  if (oStatus !== "derived" && oStatus !== "connected") {
    return { kind: "outcome", status: "UNKNOWN", derivedFrom: [] };
  }
  const value = (observation as { value?: unknown }).value as
    | { realityVerdict?: unknown; whatHappened?: unknown }
    | undefined;
  // Defensive: a malformed record could mark observation derived without a value.
  if (value === null || typeof value !== "object") {
    return { kind: "outcome", status: "UNKNOWN", derivedFrom: [] };
  }
  const verdict = value.realityVerdict;
  // Reality is only OBSERVED when a probe returned a real verdict.
  if (verdict !== "agree" && verdict !== "disagree") {
    return { kind: "outcome", status: "UNKNOWN", derivedFrom: [] };
  }
  const whatHappened = typeof value.whatHappened === "string" ? value.whatHappened : "";
  return {
    kind: "outcome",
    status: "REALITY_OBSERVED",
    statement: `Reality ${verdict}: ${whatHappened}`.trim(),
    derivedFrom: ["observation"],
  };
}

// ─── Public classifier ──────────────────────────────────────────────────────────

/**
 * Classify a record into its four EpistemicObjects, in fixed order:
 * inference, hypothesis, prediction, outcome.
 *
 * Pure: reads ONLY the record; invents nothing; never throws. Honors the
 * certification rule structurally — no reasoning kind can carry REALITY_OBSERVED.
 */
export function classifyEpistemic(
  record: GovernedDecisionRecord,
): readonly EpistemicObject[] {
  // Defensive: a null/non-object record degrades to all-UNKNOWN (never throws).
  if (record === null || typeof record !== "object") {
    return [
      { kind: "inference", status: "UNKNOWN", derivedFrom: [] },
      { kind: "hypothesis", status: "UNKNOWN", derivedFrom: [] },
      { kind: "prediction", status: "UNKNOWN", derivedFrom: [] },
      { kind: "outcome", status: "UNKNOWN", derivedFrom: [] },
    ];
  }

  return [
    classifyInference(record),
    classifyHypothesis(record),
    classifyPrediction(record),
    classifyOutcome(record),
  ];
}
