/**
 * Invocation lineage -- a pure read-side view over STORED governed decisions.
 *
 * Charter: docs/architecture/USESTEADY_EXPLICIT_INVOCATION_LINEAGE_V1.md, S3.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 *
 *   Explicit Invocation Lineage records each invocation's declared dependencies as
 *   `references` edges on the record (S1). This module reconstructs the CERTIFIED
 *   lineage chain (A -> B -> C) by walking those edges across the append-only
 *   store: from a queried record, follow each `references[].ref` to the record it
 *   points at, transitively, surfacing each node's certification level and each
 *   edge's authority band.
 *
 *   It is the read-side dual of S1: S1 declares "this invocation depends on X";
 *   S3 answers "what is the full, certified chain this decision stands on?".
 *
 *   Like projection.ts / epistemic.ts / elicitation.ts this is PURE: it reads only
 *   the stored records handed to it, adds no stage, no authority, changes no record
 *   and no content hash, and never throws over malformed/foreign records.
 *
 * ── Honesty (gauge law) ─────────────────────────────────────────────────────────
 *
 *   - A reference whose `ref` matches no stored record is `resolved: false` and is
 *     reported in `unresolved` -- an external/asserted artifact or a record not in
 *     this store. It is never silently dropped and never fabricated into a node.
 *   - A node whose record carries no readable certification is `"unknown"` -- never
 *     defaulted to a certified level.
 *
 * ── Cycle safety ────────────────────────────────────────────────────────────────
 *
 *   References are content-addressed (a record can only reference records that
 *   already existed, so a true cycle is not expected), but the walk is guarded by a
 *   visited set so a malformed/hand-edited store with a back-edge cannot loop.
 */

import type { AuthorityLevel } from "../../core/k1/types.js";
import type { CertificationLevel, ReferenceKind } from "./types.js";
import type { StoredKind, StoredRecord } from "./store.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** A resolved or external dependency edge declared by one record. */
export type LineageEdge = {
  /** The record that DECLARED this reference. */
  readonly fromRecordId: string;
  /** The reference target (a recordId, or an external artifact ref). */
  readonly toRef: string;
  readonly kind: ReferenceKind;
  readonly authorityBand: AuthorityLevel;
  readonly verifiedInThisInvocation: boolean;
  /** True IFF `toRef` matches a stored record in the walked set. */
  readonly resolved: boolean;
};

/** A node in the lineage: a stored decision reachable from the root. */
export type LineageNode = {
  readonly recordId: string;
  readonly goal: string;
  readonly kind: StoredKind;
  /** The certified basis authority of this node, or "unknown" if none recorded. */
  readonly certification: CertificationLevel | "unknown";
};

export type InvocationLineage = {
  /** The queried recordId. */
  readonly root: string;
  /** Root + transitively reachable referenced records, in breadth-first order. */
  readonly nodes: readonly LineageNode[];
  /** Every reference edge encountered, in walk order. */
  readonly edges: readonly LineageEdge[];
  /** De-duped refs that matched no stored record (external/missing), in first-seen order. */
  readonly unresolved: readonly string[];
};

// ─── Defensive readers (mirror projection.ts / store.ts never-throws) ───────────

const REFERENCE_KINDS: ReadonlySet<string> = new Set<ReferenceKind>([
  "prior_observation",
  "certified_decision",
  "verified_artifact",
  "asserted_artifact",
]);

const AUTHORITY_LEVELS: ReadonlySet<string> = new Set<AuthorityLevel>([
  "source_of_record",
  "verified_system_state",
  "human_judgment",
  "agent_inference",
  "unverified",
]);

const CERTIFICATION_LEVELS: ReadonlySet<string> = new Set<CertificationLevel>([
  "certified_by_source",
  "requires_human_review",
  "uncertified",
]);

function readGoal(record: unknown): string {
  if (record === null || typeof record !== "object") return "";
  const hi = (record as { humanIntent?: unknown }).humanIntent;
  if (hi === null || typeof hi !== "object") return "";
  const goal = (hi as { goal?: unknown }).goal;
  return typeof goal === "string" ? goal : "";
}

/** Read the record's certified basis authority, or "unknown" (gauge law). */
function readCertification(record: unknown): CertificationLevel | "unknown" {
  if (record === null || typeof record !== "object") return "unknown";
  const ta = (record as { truthArbitration?: unknown }).truthArbitration;
  if (ta === null || typeof ta !== "object") return "unknown";
  const status = (ta as { status?: unknown }).status;
  if (status !== "connected" && status !== "derived") return "unknown";
  const value = (ta as { value?: unknown }).value;
  if (value === null || typeof value !== "object") return "unknown";
  const cert = (value as { certification?: unknown }).certification;
  if (cert === null || typeof cert !== "object") return "unknown";
  const level = (cert as { level?: unknown }).level;
  return typeof level === "string" && CERTIFICATION_LEVELS.has(level)
    ? (level as CertificationLevel)
    : "unknown";
}

/** Read a record's reference edges defensively (array of well-formed edges only). */
function readReferenceEdges(record: unknown): readonly LineageEdgeRaw[] {
  if (record === null || typeof record !== "object") return [];
  const raw = (record as { references?: unknown }).references;
  if (!Array.isArray(raw)) return [];
  const out: LineageEdgeRaw[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== "object") continue;
    const kind = (e as { kind?: unknown }).kind;
    const ref = (e as { ref?: unknown }).ref;
    const band = (e as { authorityBand?: unknown }).authorityBand;
    const verified = (e as { verifiedInThisInvocation?: unknown }).verifiedInThisInvocation;
    if (typeof kind !== "string" || !REFERENCE_KINDS.has(kind)) continue;
    if (typeof ref !== "string" || ref.length === 0) continue;
    out.push({
      kind: kind as ReferenceKind,
      toRef: ref,
      authorityBand:
        typeof band === "string" && AUTHORITY_LEVELS.has(band)
          ? (band as AuthorityLevel)
          : "unverified",
      verifiedInThisInvocation: verified === true,
    });
  }
  return out;
}

type LineageEdgeRaw = Omit<LineageEdge, "fromRecordId" | "resolved">;

// ─── Public builder ───────────────────────────────────────────────────────────

/**
 * Build the certified invocation lineage rooted at `rootRecordId`.
 *
 * Returns `null` only when the root recordId is not present in `records` (an
 * operator query for a record that does not exist -- a mistake, not an honest
 * absence). Otherwise returns the breadth-first chain with every edge classified
 * resolved/external and every node carrying its certification level.
 *
 * Pure: reads only `records`; invents nothing; never throws; cycle-safe.
 */
export function buildInvocationLineage(
  records: readonly StoredRecord[],
  rootRecordId: string,
): InvocationLineage | null {
  // Index by recordId, first occurrence wins (matches store readAll dedup).
  const byId = new Map<string, StoredRecord>();
  if (Array.isArray(records)) {
    for (const s of records) {
      const id = s?.record?.recordId;
      if (typeof id === "string" && !byId.has(id)) byId.set(id, s);
    }
  }

  const rootStored = byId.get(rootRecordId);
  if (rootStored === undefined) return null;

  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const unresolved: string[] = [];
  const unresolvedSeen = new Set<string>();
  const visited = new Set<string>();

  // Breadth-first over resolved references; visited set makes it cycle-safe.
  const queue: string[] = [rootRecordId];
  visited.add(rootRecordId);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const stored = byId.get(id);
    if (stored === undefined) continue; // only enqueue resolved ids; defensive.

    nodes.push({
      recordId: id,
      goal: readGoal(stored.record),
      kind: stored.envelope.kind,
      certification: readCertification(stored.record),
    });

    for (const raw of readReferenceEdges(stored.record)) {
      const resolved = byId.has(raw.toRef);
      edges.push({ fromRecordId: id, resolved, ...raw });
      if (resolved) {
        if (!visited.has(raw.toRef)) {
          visited.add(raw.toRef);
          queue.push(raw.toRef);
        }
      } else if (!unresolvedSeen.has(raw.toRef)) {
        unresolvedSeen.add(raw.toRef);
        unresolved.push(raw.toRef);
      }
    }
  }

  return { root: rootRecordId, nodes, edges, unresolved };
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Render an invocation lineage to deterministic, ASCII text lines (CLI/Portal).
 * Edges are grouped under the node that declared them, in walk order.
 */
export function renderLineageLines(lineage: InvocationLineage): readonly string[] {
  const lines: string[] = [`Invocation lineage for ${oneLine(lineage.root)}:`];

  for (const node of lineage.nodes) {
    const goal = node.goal.length > 0 ? ` "${oneLine(node.goal)}"` : "";
    lines.push(`  ${oneLine(node.recordId)} [${node.kind}]${goal} | certification ${node.certification}`);
    for (const e of lineage.edges) {
      if (e.fromRecordId !== node.recordId) continue;
      const resolved = e.resolved ? "resolved" : "external";
      const verified = e.verifiedInThisInvocation ? "re-verified" : "not re-verified";
      lines.push(
        `    -> [${oneLine(e.kind)}] ${oneLine(e.toRef)} | authority ${oneLine(e.authorityBand)} | ${resolved} | ${verified}`,
      );
    }
  }

  if (lineage.nodes.length === 1 && lineage.edges.length === 0) {
    lines.push("  (no declared references -- this is a root invocation)");
  }

  if (lineage.unresolved.length > 0) {
    lines.push(
      `Unresolved references (${lineage.unresolved.length}): ${lineage.unresolved.map(oneLine).join(", ")}`,
    );
  }

  return lines;
}
