/**
 * Phase D — Pure projection of GovernedDecisionRecord.
 *
 * See docs/architecture/USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md (FROZEN v1).
 *
 * ── Gauge law (enforced here, not just documented) ───────────────────────────
 *
 *   This module reads ONE thing: a GovernedDecisionRecord. It reads nothing
 *   else — no filesystem, no environment, no sensors, no other modules (aside
 *   from ./types.js which is the record's own type definitions).
 *
 *   The projection maps each record section to a ProjectedSection tagged with
 *   the section's gauge status:
 *
 *     "unavailable" → only the reason is surfaced; no display value, no
 *                     fabricated summary. The "display" key is ABSENT.
 *
 *     "connected"   → a display string derived ONLY from section.value.
 *                     Invented text is forbidden; every rendered field must
 *                     exist on the value.
 *
 *     "derived"     → same as connected, plus derivedFrom[] lists the stages
 *                     from which this section was derived, verbatim from the
 *                     record (no normalization).
 *
 *   For decisionBasis, each of the five sub-sections is its own DecisionSection.
 *   The display string honors the gauge law per sub-section: a sub-section that
 *   is "unavailable" contributes its status label only — never a fabricated
 *   value.
 *
 * ── Never throws ─────────────────────────────────────────────────────────────
 *
 *   If a display builder encounters an unexpected shape it degrades that
 *   section's display to "(unrenderable)" rather than throwing. No fabrication.
 *
 * ── No invention ─────────────────────────────────────────────────────────────
 *
 *   Every string in a ProjectedSection is either:
 *     (a) copied verbatim from the record (recordId, createdAt, reason, stage names,
 *         derivedFrom stage names), or
 *     (b) a short structural label derived ONLY from fields present in the payload.
 *   No computed metric, no inferred status, no synthetic field is ever added.
 */

import type {
  GovernedDecisionRecord,
  DecisionSection,
  StageName,
  UnderstandingPayload,
  CandidatePlan,
  ConstitutionPayload,
  DecisionBasisPayload,
  TruthArbitrationPayload,
  RatificationPayload,
  ExecutionPayload,
  ObservationPayload,
  ReferenceEdge,
} from "./types.js";

import { STAGE_ORDER } from "./types.js";
import { evaluateElicitation, type ElicitationOutcome } from "./elicitation.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ProjectedStatus = "connected" | "derived" | "unavailable";

export type ProjectedSection =
  | { readonly stage: string; readonly status: "connected"; readonly display: string }
  | {
      readonly stage: string;
      readonly status: "derived";
      readonly display: string;
      readonly derivedFrom: readonly string[];
    }
  | { readonly stage: string; readonly status: "unavailable"; readonly reason: string };

/**
 * A projected lineage edge: the declared reference dependencies, surfaced
 * verbatim from the record. No fabrication -- a malformed edge is dropped rather
 * than guessed.
 */
export type ProjectedReferenceEdge = {
  readonly kind: string;
  readonly ref: string;
  readonly authorityBand: string;
  readonly verifiedInThisInvocation: boolean;
};

export type GovernedDecisionProjection = {
  readonly recordId: string;
  readonly createdAt: string;
  readonly humanIntent: { readonly goal: string; readonly constraints: readonly string[] };
  /** One projected section per pipeline stage, in STAGE_ORDER. */
  readonly sections: readonly ProjectedSection[];
  readonly priorObservationRef: string | null;
  /** Declared invocation-lineage edges (INV-EIL-6), surfaced from the record. */
  readonly references: readonly ProjectedReferenceEdge[];
  /**
   * Elicitation gate (S2): whether a confident draft exists ("ready") or the
   * invocation should close and be re-invoked with declared answers
   * ("needs_input", with the verbatim questions). Pure read-side; no authority.
   */
  readonly elicitation: ElicitationOutcome;
};

// ─── Per-stage display builders ───────────────────────────────────────────────
//
// Each builder takes the value for that stage and returns a concise display
// string. The string is derived ONLY from the fields present in the payload.
// A builder must never fabricate a value or invent a field.
//
// Required-field guards: a connected/derived section read from a partial or
// foreign persisted record could be missing fields. Template literals would turn
// those into the literal text "undefined" — which reads as REAL data to a CLI/UI
// consumer and violates the gauge law. Instead, the guards throw on a missing
// field; projectSection's try/catch then degrades the whole section to
// "(unrenderable)" honestly, never printing fabricated values. Each builder
// receives `unknown` so a malformed payload cannot silently bypass the guards.

function reqStr(v: unknown): string {
  if (typeof v !== "string") {
    throw new Error("missing string field");
  }
  return v;
}

function reqArr(v: unknown): readonly unknown[] {
  if (!Array.isArray(v)) {
    throw new Error("missing array field");
  }
  return v;
}

function reqScalar(v: unknown): string {
  if (v === undefined || v === null || typeof v === "object") {
    throw new Error("missing scalar field");
  }
  return String(v);
}

function buildUnderstandingDisplay(raw: unknown): string {
  const value = raw as UnderstandingPayload;
  const parts: string[] = [];
  parts.push(`intent: "${reqStr(value.intent)}"`);
  parts.push(`context: "${reqStr(value.contextSummary)}"`);
  parts.push(`plans: ${reqArr(value.candidatePlans).length}`);
  // Surface the structured executable op verbatim from the value, when present.
  // Gauge law: only rendered if a plan actually carries one — never fabricated.
  const firstOp = reqArr(value.candidatePlans)
    .map((p) => (p as CandidatePlan | undefined)?.operation)
    .find((op): op is NonNullable<typeof op> => op !== undefined);
  if (firstOp !== undefined) {
    parts.push(`op: ${reqStr(firstOp.kind)} ${reqStr(firstOp.path)}`);
  }
  if (reqArr(value.unknowns).length > 0) {
    parts.push(`unknowns: ${value.unknowns.length}`);
  }
  return parts.join("; ");
}

function buildConstitutionDisplay(raw: unknown): string {
  const value = raw as ConstitutionPayload;
  const parts: string[] = [];
  parts.push(`invariants applied: ${reqArr(value.appliedInvariants).length}`);
  parts.push(`fingerprint: ${reqStr(value.stampFingerprint).slice(0, 8)}...`);
  return parts.join("; ");
}

/**
 * Build the decisionBasis display string.
 *
 * Each of the five sub-sections is its own DecisionSection with its own gauge
 * status. The gauge law is honored per sub-section:
 *   - "unavailable" → label: "unavailable" (NO value printed)
 *   - "connected"   → label: "connected"
 *   - "derived"     → label: "derived"
 *
 * This is the central honesty point for the decisionBasis stage: a sub-section
 * that has no sensor wired must not contribute a display value, only its status.
 */
function buildDecisionBasisDisplay(raw: unknown): string {
  const value = raw as DecisionBasisPayload;
  const subSpecs: ReadonlyArray<{ readonly name: string; readonly section: unknown }> = [
    { name: "evidence", section: value.evidence },
    { name: "policy", section: value.policy },
    { name: "constraints", section: value.constraints },
    { name: "sourceOfRecord", section: value.sourceOfRecord },
    { name: "runtimeState", section: value.runtimeState },
  ];

  return subSpecs
    .map(({ name, section }) => {
      // A sub-section must be an object carrying a string status; otherwise the
      // payload is partial and the gauge status is unknown — degrade the whole
      // decisionBasis display rather than printing "undefined".
      if (section === null || typeof section !== "object") {
        throw new Error(`missing decisionBasis sub-section: ${name}`);
      }
      const status = (section as { status?: unknown }).status;
      return `${name}: ${reqStr(status)}`;
    })
    .join("; ");
}

function buildTruthArbitrationDisplay(raw: unknown): string {
  const value = raw as TruthArbitrationPayload;
  const parts: string[] = [];
  parts.push(`conflicts: ${reqArr(value.conflicts).length}`);
  parts.push(`resolution: "${reqStr(value.resolution)}"`);
  parts.push(`confidence: ${reqScalar(value.certifiedConfidence)}`);
  // Certification (Phase C): surface the level + reason count verbatim from the
  // value. Defensive read: a record persisted BEFORE this field existed omits it
  // — gauge law, surface nothing rather than the literal "undefined". A new record
  // always carries it (the stage sets it unconditionally).
  const cert = (value as { certification?: unknown }).certification;
  if (cert !== null && typeof cert === "object") {
    const level = (cert as { level?: unknown }).level;
    if (typeof level === "string") {
      const reasons = (cert as { reasons?: unknown }).reasons;
      const reasonCount = Array.isArray(reasons) ? reasons.length : 0;
      parts.push(`certification: ${level} (${reasonCount} reason(s))`);
    }
  }
  if (reqArr(value.preservedUnknowns).length > 0) {
    parts.push(`preservedUnknowns: ${value.preservedUnknowns.length}`);
  }
  return parts.join("; ");
}

function buildRatificationDisplay(raw: unknown): string {
  const value = raw as RatificationPayload;
  // Seat kind (S1 / INV-SO-2): rendered verbatim so a persona ratification is
  // never displayed as a human one. Defensive read: records persisted before
  // S1 omit the field — shown honestly as unrecorded, never silently "human".
  const rawKind = (value as { approverKind?: unknown }).approverKind;
  const kind =
    rawKind === "human" || rawKind === "persona" ? rawKind : "kind unrecorded (pre-S1)";
  return `decision: ${reqScalar(value.decision)}; approver: ${reqStr(value.approver)} [${kind}]; at: ${reqStr(value.at)}`;
}

function buildExecutionDisplay(raw: unknown): string {
  const value = raw as ExecutionPayload;
  const parts: string[] = [];
  parts.push(`steps: ${reqArr(value.steps).length}`);
  parts.push(`ranWhatWasApproved: ${reqScalar(value.ranWhatWasApproved)}`);
  parts.push(`deterministic: ${reqScalar(value.deterministic)}`);
  // When a real executor actuated ops, surface the ran/failed tally verbatim from
  // the results array (gauge law: only when present; counts are derived, not
  // fabricated). Absent results → nothing added.
  if (Array.isArray(value.results)) {
    const ran = value.results.filter((r) => r && r.status === "ran").length;
    const failed = value.results.filter((r) => r && r.status === "failed").length;
    parts.push(`actuated: ${ran} ran, ${failed} failed`);
  }
  return parts.join("; ");
}

function buildObservationDisplay(raw: unknown): string {
  const value = raw as ObservationPayload;
  const parts: string[] = [];
  parts.push(`whatHappened: "${reqStr(value.whatHappened)}"`);
  parts.push(`intendedVsActual: ${reqScalar(value.intendedVsActual)}`);
  parts.push(`realityVerdict: ${reqScalar(value.realityVerdict)}`);
  // ABSENT when no probe ran (gauge law): only surface the explanation that a
  // wired probe actually produced; never fabricate a reason for "unknown".
  if (typeof value.realityDetail === "string" && value.realityDetail.length > 0) {
    parts.push(`realityDetail: "${oneLine(value.realityDetail)}"`);
  }
  parts.push(`feedsNextCycle: ${reqScalar(value.feedsNextCycle)}`);
  return parts.join("; ");
}

// ─── Section projector ────────────────────────────────────────────────────────

/**
 * Project a single record section into a ProjectedSection.
 *
 * Gauge law is enforced here:
 *   - "unavailable" → { stage, status, reason } — no display key at all
 *   - "connected"   → { stage, status, display } — display is derived from value
 *   - "derived"     → { stage, status, display, derivedFrom } — same + provenance
 *
 * The display builder is chosen by stage name. If the builder throws for any
 * unexpected reason, the section degrades to display: "(unrenderable)" without
 * propagating the exception — and crucially without fabricating data.
 */
function projectSection(stage: StageName, section: DecisionSection<unknown>): ProjectedSection {
  // Defensive: a partial/persisted/foreign record could carry a missing, null,
  // or non-object section. Reading `.status` off such a value would throw before
  // the display-builder try/catch, breaking the never-throws contract. Degrade
  // to unavailable — never fabricate a connected section out of nothing.
  if (section === null || typeof section !== "object") {
    return { stage, status: "unavailable", reason: "section missing or malformed" };
  }

  if (section.status === "unavailable") {
    // A persisted/foreign record could carry an unavailable section whose reason
    // is missing or non-string. renderProjectionLines must always emit an honest
    // explanation, never "reason: undefined". Coerce to a stable fallback.
    const reason =
      typeof section.reason === "string" && section.reason.length > 0
        ? section.reason
        : "unavailable (no reason given)";
    return { stage, status: "unavailable", reason };
  }

  // Only "connected" and "derived" are legible authority statuses. Any other
  // value (mistyped, future, or absent status on a persisted record) must NOT
  // be coerced into "connected" — that would assert authority the record does
  // not carry, violating the gauge law. Degrade to unavailable honestly.
  if (section.status !== "connected" && section.status !== "derived") {
    return { stage, status: "unavailable", reason: "section status unrecognized" };
  }

  let display: string;
  try {
    display = buildDisplay(stage, section.value);
  } catch (_err) {
    display = "(unrenderable)";
  }

  if (section.status === "derived") {
    // Defensive: a persisted or hand-built record could carry status "derived"
    // with a missing or non-array derivedFrom. Guard so the projection honors
    // its "never throws" contract for any record shape (CLI/UI/Portal read
    // persisted records). Never fabricate provenance — degrade to [].
    const derivedFrom = Array.isArray(section.derivedFrom)
      ? section.derivedFrom.map(String)
      : [];
    return {
      stage,
      status: "derived",
      display,
      derivedFrom,
    };
  }

  // status === "connected"
  return { stage, status: "connected", display };
}

/**
 * Route a value to the appropriate per-stage display builder.
 *
 * Each branch casts only to the expected payload type for that stage; there is
 * no cross-stage inspection. If the stage name is unrecognized (future stage
 * added without updating this function), the display degrades to
 * "(unrenderable)" rather than fabricating a value.
 */
function buildDisplay(stage: StageName, value: unknown): string {
  switch (stage) {
    case "understanding":
      return buildUnderstandingDisplay(value as UnderstandingPayload);
    case "constitution":
      return buildConstitutionDisplay(value as ConstitutionPayload);
    case "decisionBasis":
      return buildDecisionBasisDisplay(value as DecisionBasisPayload);
    case "truthArbitration":
      return buildTruthArbitrationDisplay(value as TruthArbitrationPayload);
    case "ratification":
      return buildRatificationDisplay(value as RatificationPayload);
    case "execution":
      return buildExecutionDisplay(value as ExecutionPayload);
    case "observation":
      return buildObservationDisplay(value as ObservationPayload);
    default: {
      const _exhaustive: never = stage;
      void _exhaustive;
      return "(unrenderable)";
    }
  }
}

// ─── Main projection function ─────────────────────────────────────────────────

/**
 * Project a GovernedDecisionRecord into a GovernedDecisionProjection.
 *
 * Pure function: reads ONLY the record; produces ONLY derived values.
 * Does not read any external source. Does not throw.
 *
 * The sections array has exactly one entry per STAGE_ORDER stage, in canonical
 * order. No stage is added; no stage is dropped.
 */
export function projectGovernedDecision(record: GovernedDecisionRecord): GovernedDecisionProjection {
  // Never-throws contract starts at the outermost read: a null/undefined or
  // non-object record (bad load, caller mistake) must degrade, not crash. Every
  // stage projects as unavailable; the projection invents nothing.
  if (record === null || typeof record !== "object") {
    return {
      recordId: "",
      createdAt: "",
      humanIntent: { goal: "", constraints: [] },
      sections: STAGE_ORDER.map((stage) => ({
        stage,
        status: "unavailable" as const,
        reason: "record missing or malformed",
      })),
      priorObservationRef: null,
      references: [],
      elicitation: evaluateElicitation(record),
    };
  }

  const sections: ProjectedSection[] = STAGE_ORDER.map((stage) => {
    const section = record[stage] as DecisionSection<unknown>;
    return projectSection(stage, section);
  });

  // Defensive top-level reads: a partial/corrupted persisted record could omit
  // or mistype humanIntent. The module's never-throws contract covers the whole
  // projection, not just stage sections — and a non-array `constraints` would
  // later throw in renderProjectionLines on `.length`. Degrade honestly; never
  // fabricate an intent.
  const intent =
    record.humanIntent !== null && typeof record.humanIntent === "object"
      ? record.humanIntent
      : { goal: "", constraints: [] };
  const goal = typeof intent.goal === "string" ? intent.goal : "";
  const constraints = Array.isArray(intent.constraints)
    ? intent.constraints.map(String)
    : [];

  return {
    recordId: typeof record.recordId === "string" ? record.recordId : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    humanIntent: {
      goal,
      constraints,
    },
    sections,
    priorObservationRef: typeof record.priorObservationRef === "string" ? record.priorObservationRef : null,
    references: projectReferenceEdges(record.references),
    elicitation: evaluateElicitation(record),
  };
}

/**
 * Project the record's lineage edges defensively. A persisted/foreign record
 * could omit `references` (pre-field) or carry a malformed edge; drop anything
 * that is not a well-formed edge rather than fabricate. Never throws.
 */
function projectReferenceEdges(raw: unknown): readonly ProjectedReferenceEdge[] {
  if (!Array.isArray(raw)) return [];
  const edges: ProjectedReferenceEdge[] = [];
  for (const e of raw as readonly unknown[]) {
    if (e === null || typeof e !== "object") continue;
    const kind = (e as { kind?: unknown }).kind;
    const ref = (e as { ref?: unknown }).ref;
    const band = (e as { authorityBand?: unknown }).authorityBand;
    const verified = (e as { verifiedInThisInvocation?: unknown }).verifiedInThisInvocation;
    if (typeof kind !== "string" || typeof ref !== "string" || typeof band !== "string") continue;
    edges.push({
      kind,
      ref,
      authorityBand: band,
      verifiedInThisInvocation: verified === true,
    });
  }
  return edges;
}

// ─── Reference text renderer ──────────────────────────────────────────────────

/**
 * Render a GovernedDecisionProjection as a readonly array of display lines.
 *
 * Pure function: reads only the projection; same input always yields identical
 * output. No I/O, no side effects.
 *
 * Format:
 *   Record <recordId> — <createdAt>
 *   Intent: <goal>
 *   Constraints: <constraint1>, <constraint2>, ... | (none)
 *   [priorRef: <ref>]                              (omitted when null)
 *   ---
 *   UNDERSTANDING [connected] <display>
 *   CONSTITUTION [connected] <display>
 *   DECISION_BASIS [unavailable] reason: <reason>
 *   ...
 *
 * This is the reference surface renderer; a future UI/CLI/Portal consumes the
 * same projection object and may choose its own rendering strategy.
 */
export function renderProjectionLines(p: GovernedDecisionProjection): readonly string[] {
  const lines: string[] = [];

  lines.push(`Record ${oneLine(p.recordId)} -- ${oneLine(p.createdAt)}`);
  lines.push(`Intent: ${oneLine(p.humanIntent.goal)}`);
  const constraintsStr =
    p.humanIntent.constraints.length > 0
      ? p.humanIntent.constraints.map(oneLine).join(", ")
      : "(none)";
  lines.push(`Constraints: ${constraintsStr}`);
  if (p.priorObservationRef !== null) {
    lines.push(`priorRef: ${oneLine(p.priorObservationRef)}`);
  }
  // Explicit Invocation Lineage: declared dependency edges (INV-EIL-6). Omitted
  // entirely when the invocation declared none (a fresh invocation).
  if (p.references.length > 0) {
    lines.push(`Lineage: ${p.references.length} declared reference(s)`);
    for (const e of p.references) {
      const verified = e.verifiedInThisInvocation ? "re-verified" : "not re-verified";
      lines.push(
        `  - [${oneLine(e.kind)}] ${oneLine(e.ref)} | authority ${oneLine(e.authorityBand)} | ${verified}`,
      );
    }
  }
  // Elicitation gate (S2): when the invocation needs input, surface EXACTLY what
  // is missing and the re-invoke contract. Omitted entirely when ready, so the
  // happy path stays clean.
  if (p.elicitation.status === "needs_input") {
    lines.push(
      `NEEDS INPUT (${oneLine(p.elicitation.basis)}): re-invoke with answers as declared inputs`,
    );
    for (const q of p.elicitation.questions) {
      lines.push(`  ? ${oneLine(q)}`);
    }
  }
  lines.push("---");

  for (const section of p.sections) {
    const stageLabel = section.stage.toUpperCase();
    if (section.status === "unavailable") {
      lines.push(`${stageLabel} [unavailable] reason: ${oneLine(section.reason)}`);
    } else if (section.status === "derived") {
      const fromStr = section.derivedFrom.map(oneLine).join(", ");
      lines.push(`${stageLabel} [derived] ${oneLine(section.display)} (derivedFrom: ${fromStr})`);
    } else {
      lines.push(`${stageLabel} [connected] ${oneLine(section.display)}`);
    }
  }

  return lines;
}

/**
 * Collapse any newline / carriage-return into a single space so a record-derived
 * value cannot inject extra lines into the rendered output (line-oriented display
 * spoofing — e.g. a goal containing "\nRATIFICATION [connected] approved" forging
 * a stage line in a CLI/log viewer). Display honesty: one record field -> one
 * inline fragment. Never changes the projection object; only the text rendering.
 */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}
