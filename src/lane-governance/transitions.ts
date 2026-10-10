/**
 * Lane transitions — N.S3 (NORTH_STAR_EARNING_MAP_V1).
 *
 * Lane opening and closing become governed decision records through the FULL
 * spine (draft → persona ratification → final), exactly like charter
 * ratification (Gate 1). The semantic content travels as declared reference
 * edges (INV-EIL-2/-6), so the wave-order chain is reconstructable from stored
 * records alone — no ledger, no markdown (WORK_PROGRAM_GOVERNANCE_V1 §1
 * claim 2; INV-LG-6: records are the channel, doc ledgers are projections).
 *
 * Reference vocabulary (frozen for this record family):
 *
 *   lane-closing:<laneId>        asserted_artifact — marks a CLOSING record
 *   lane-opening:<laneId>        asserted_artifact — marks an OPENING record
 *   merge:<repo>@<sha>           asserted_artifact — one per landing merge (closing)
 *   closed-at:<iso> / opened-at:<iso>
 *                                asserted_artifact — the honest EVENT time
 *   recorded:live | recorded:retrospective
 *                                asserted_artifact — costume prevention: a
 *                                backfilled record says so (gauge law)
 *   charter:absent:pre-g1        asserted_artifact — a pre-G1 lane had no
 *                                ratified charter; the absence is recorded
 *                                honestly, never fabricated
 *   <recordId>                   certified_decision — the lane's charter
 *                                ratification record(s), and (opening only)
 *                                each dependency lane's CLOSING record
 *
 * Authority posture (REV_1 standing test): NOTHING here schedules, orders, or
 * triggers work. `readLaneEligibility` is a deterministic READ of stored
 * closing records — delivery-gate authority class. The authoring path fails
 * closed when a declared dependency has no stored closing record; a human (or
 * the ratified map) remains the only sequencing authority.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  produceDraft,
  produceFinal,
  ratifiableFingerprint,
  makeSandboxedFsExecutor,
  makeFsRealityProbe,
} from "../governed-decision/runner.js";
import {
  makePersonaRatification,
  syntheticRatifierEnabled,
  SYNTHETIC_RATIFIER_ENV,
} from "../governed-decision/ratifier/persona.js";
import type { GovernedDecisionStore, StoredRecord } from "../governed-decision/store.js";
import type { Reference } from "../governed-decision/types.js";

// ─── Vocabulary ───────────────────────────────────────────────────────────────

export type LaneTransitionType = "closing" | "opening";
export type RecordedContext = "live" | "retrospective";

/** Honest citation for lanes that ran before G1 existed (closing records only). */
export const CHARTER_ABSENT_PRE_G1 = "charter:absent:pre-g1";

/** Canonical lane id: lowercase, dots to dashes ("N.S1" → "n-s1"). */
export function normalizeLaneId(id: string): string {
  return id.trim().toLowerCase().replace(/\./g, "-");
}

export function laneTransitionMarker(type: LaneTransitionType, laneId: string): string {
  return `lane-${type}:${normalizeLaneId(laneId)}`;
}

export function mergeRef(repo: string, sha: string): string {
  return `merge:${repo.trim()}@${sha.trim()}`;
}

export function eventAtRef(type: LaneTransitionType, iso: string): string {
  return `${type === "closing" ? "closed-at" : "opened-at"}:${iso.trim()}`;
}

export function recordedContextRef(context: RecordedContext): string {
  return `recorded:${context}`;
}

/** Parse a transition marker ref; null when the ref is not a marker. */
export function parseTransitionMarker(
  ref: string,
): { readonly type: LaneTransitionType; readonly laneId: string } | null {
  const m = /^lane-(closing|opening):(.+)$/.exec(ref);
  if (m === null) return null;
  return { type: m[1] as LaneTransitionType, laneId: m[2]! };
}

// ─── Reading transitions from the store (never-throws posture) ────────────────

function recordReferences(stored: StoredRecord): readonly { kind: string; ref: string }[] {
  const raw = (stored.record as { references?: unknown }).references;
  if (!Array.isArray(raw)) return [];
  const out: { kind: string; ref: string }[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== "object") continue;
    const kind = (e as { kind?: unknown }).kind;
    const ref = (e as { ref?: unknown }).ref;
    if (typeof kind === "string" && typeof ref === "string") out.push({ kind, ref });
  }
  return out;
}

function isApprovedFinal(stored: StoredRecord): boolean {
  if (stored.envelope.kind !== "final") return false;
  const rat = stored.record.ratification as
    | { status?: unknown; value?: { decision?: unknown } }
    | null
    | undefined;
  return (
    rat !== null &&
    rat !== undefined &&
    rat.status === "connected" &&
    rat.value !== null &&
    typeof rat.value === "object" &&
    rat.value.decision === "approved"
  );
}

/**
 * Find the stored transition record of a given type for a lane: an APPROVED
 * FINAL whose declared references carry the transition marker. When more than
 * one exists (append-only log), the latest by createdAt wins.
 */
export function findLaneTransition(
  store: GovernedDecisionStore,
  type: LaneTransitionType,
  laneId: string,
): StoredRecord | null {
  const marker = laneTransitionMarker(type, laneId);
  let found: StoredRecord | null = null;
  for (const stored of store.readAll()) {
    if (!isApprovedFinal(stored)) continue;
    if (!recordReferences(stored).some((r) => r.kind === "asserted_artifact" && r.ref === marker)) {
      continue;
    }
    if (found === null || stored.record.createdAt > found.record.createdAt) found = stored;
  }
  return found;
}

// ─── Eligibility: a deterministic READ (delivery-gate class, never a scheduler) ──

export type LaneEligibility = {
  readonly eligible: boolean;
  /** Dependency lanes whose CLOSING record is stored, with the record id. */
  readonly satisfied: readonly { readonly laneId: string; readonly recordId: string }[];
  /** Dependency lanes with NO stored closing record (normalized ids). */
  readonly missing: readonly string[];
};

/**
 * Read whether every dependency lane has a stored closing record. Pure read
 * over the store; returns facts, decides nothing, triggers nothing (REV_1).
 */
export function readLaneEligibility(
  store: GovernedDecisionStore,
  dependencies: readonly string[],
): LaneEligibility {
  const satisfied: { laneId: string; recordId: string }[] = [];
  const missing: string[] = [];
  for (const dep of dependencies) {
    const laneId = normalizeLaneId(dep);
    const closing = findLaneTransition(store, "closing", laneId);
    if (closing === null) missing.push(laneId);
    else satisfied.push({ laneId, recordId: closing.record.recordId });
  }
  return { eligible: missing.length === 0, satisfied, missing };
}

// ─── Citation walking (the chain test + any lineage reader) ───────────────────

export type TransitionCitation =
  | { readonly kind: "charter"; readonly ref: string }
  | { readonly kind: "closing"; readonly ref: string; readonly laneId: string }
  | { readonly kind: "unresolved"; readonly ref: string };

/**
 * Resolve a transition record's `certified_decision` citations against the
 * store: each is a charter ratification record (carries a `lane-charter:`
 * asserted ref) or a lane CLOSING record (carries a `lane-closing:` marker).
 * A citation whose record is not stored, or matches neither shape, is
 * `unresolved` — stated, never guessed.
 */
export function resolveTransitionCitations(
  store: GovernedDecisionStore,
  stored: StoredRecord,
): readonly TransitionCitation[] {
  const out: TransitionCitation[] = [];
  for (const r of recordReferences(stored)) {
    if (r.kind !== "certified_decision") continue;
    const cited = store.getRecord(r.ref);
    if (cited === null) {
      out.push({ kind: "unresolved", ref: r.ref });
      continue;
    }
    const citedRefs = recordReferences(cited);
    const closingMarker = citedRefs
      .map((c) => parseTransitionMarker(c.ref))
      .find((m) => m !== null && m.type === "closing");
    if (closingMarker !== undefined && closingMarker !== null) {
      out.push({ kind: "closing", ref: r.ref, laneId: closingMarker.laneId });
      continue;
    }
    if (citedRefs.some((c) => c.ref.startsWith("lane-charter:"))) {
      out.push({ kind: "charter", ref: r.ref });
      continue;
    }
    out.push({ kind: "unresolved", ref: r.ref });
  }
  return out;
}

// ─── Authoring (composes the frozen spine; no stage is modified) ──────────────

export type LaneTransitionSpec = {
  readonly laneId: string;
  readonly type: LaneTransitionType;
  /** `retrospective` for backfill; `live` at the real event. Never defaulted. */
  readonly context: RecordedContext;
  /** ISO-8601 time of the EVENT (merge landing / charter ratification). */
  readonly eventAt: string;
  /**
   * The lane's charter ratification record id(s) — more than one when the
   * charter was revised mid-lane. Empty ONLY for a pre-G1 closing, which then
   * cites `charter:absent:pre-g1` honestly.
   */
  readonly charterRecordIds: readonly string[];
  /** Closing only: every landing merge, `{ repo, sha }`. */
  readonly merges?: readonly { readonly repo: string; readonly sha: string }[];
  /** Opening only: dependency LANE IDS whose closings must already be stored. */
  readonly dependencies?: readonly string[];
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Author one lane-transition record through the full governed spine with a
 * persona seat (build lane only — INV-SO-3 fails closed without the env gate).
 *
 * Fail-closed gates, all before any record is produced:
 *   - a transition of this type already stored for the lane → refuse (append-only
 *     store; a duplicate is an error, not idempotency);
 *   - opening with any dependency lane missing a stored closing record → refuse
 *     (the eligibility read IS the gate);
 *   - closing with no merges, opening with no charter citation, bad ISO → refuse.
 */
export async function recordLaneTransition(
  store: GovernedDecisionStore,
  spec: LaneTransitionSpec,
  opts: { readonly personaId: string },
): Promise<StoredRecord> {
  if (!syntheticRatifierEnabled()) {
    throw new Error(`${SYNTHETIC_RATIFIER_ENV}=1 required (build lane only; INV-SO-3 fails closed)`);
  }
  const laneId = normalizeLaneId(spec.laneId);
  if (laneId.length === 0) throw new Error("laneId required");
  if (!ISO_RE.test(spec.eventAt)) {
    throw new Error(`eventAt must be an ISO-8601 UTC timestamp, got: ${spec.eventAt}`);
  }
  const existing = findLaneTransition(store, spec.type, laneId);
  if (existing !== null) {
    throw new Error(
      `lane ${laneId} already has a stored ${spec.type} record (${existing.record.recordId}) — append-only, never re-author`,
    );
  }

  const references: Reference[] = [
    { kind: "asserted_artifact", ref: laneTransitionMarker(spec.type, laneId) },
  ];

  if (spec.charterRecordIds.length > 0) {
    for (const id of spec.charterRecordIds) {
      if (store.getRecord(id) === null) {
        throw new Error(`charter record ${id} not in the store — cannot cite what is not stored`);
      }
      references.push({ kind: "certified_decision", ref: id });
    }
  } else if (spec.type === "closing") {
    references.push({ kind: "asserted_artifact", ref: CHARTER_ABSENT_PRE_G1 });
  } else {
    throw new Error("an opening record requires the lane's charter ratification record id (INV-LG-1)");
  }

  if (spec.type === "closing") {
    const merges = spec.merges ?? [];
    if (merges.length === 0) throw new Error("a closing record requires at least one landing merge");
    for (const m of merges) references.push({ kind: "asserted_artifact", ref: mergeRef(m.repo, m.sha) });
  } else {
    // Eligibility read as the fail-closed gate: every dependency lane's closing
    // record must already be stored; its record id becomes the citation.
    const eligibility = readLaneEligibility(store, spec.dependencies ?? []);
    if (!eligibility.eligible) {
      throw new Error(
        `lane ${laneId} is not eligible to open — no stored closing record for: ${eligibility.missing.join(", ")}`,
      );
    }
    for (const dep of eligibility.satisfied) {
      references.push({ kind: "certified_decision", ref: dep.recordId });
    }
  }

  references.push({ kind: "asserted_artifact", ref: eventAtRef(spec.type, spec.eventAt) });
  references.push({ kind: "asserted_artifact", ref: recordedContextRef(spec.context) });

  // Same pattern as charter ratification: the governed work item is the
  // transition artifact itself, actuated in a throwaway sandbox so the spine
  // runs end-to-end (execution + independent reality probe) without touching
  // the repository.
  const goal = `touch governance/lane-transitions/${laneId}.${spec.type}.json`;
  const intent = { goal, constraints: [] as readonly string[] };
  const workspace = mkdtempSync(join(tmpdir(), "lane-transition-"));

  try {
    const draft = await produceDraft(intent, { references }, { basisWorkspace: workspace });
    const storedDraft = store.appendDraft(draft);

    const fingerprint = ratifiableFingerprint(draft);
    if (fingerprint === null) {
      throw new Error("draft produced no ratifiable fingerprint — nothing stamped to ratify");
    }

    const ratification = makePersonaRatification({
      personaId: opts.personaId,
      decision: "approved",
      ratifiedFingerprint: fingerprint,
    });

    const final = await produceFinal(intent, ratification, {
      executor: makeSandboxedFsExecutor(workspace),
      realityProbe: makeFsRealityProbe(workspace),
      references,
      basisWorkspace: workspace,
    });
    return store.appendFinal(final, storedDraft.envelope.threadId, storedDraft.record.recordId);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
