/**
 * USESTEADY_MEMORY_CONTRACT_V0 — canonical types (MEM.S1).
 *
 * Frozen contract: docs/product/USESTEADY_MEMORY_CONTRACT_V0.md (usesteady-ops).
 * All types are immutable once written. Every identifier, hash, version and
 * timestamp is assigned by the core write path (gate.ts), never by an adapter
 * and never trusted from input (V7).
 */

export type WorkItem = {
  readonly workItemId: string;
  readonly operatorId: string;
  readonly createdAt: string;
  /** Reference to latest RATIFIED MemoryPoint. Never a copy (V5). */
  readonly latestRatifiedPointId: string | null;
  /** MEM.S3 (REV_1): hierarchy membership. Null = unscoped. Assigned only
   *  by a human act. */
  readonly scopeId: string | null;
};

/** MEM.S3 (REV_1): hierarchy node above WorkItem — a project, or a
 *  collection of projects. Per-operator (MEM-8 symmetry); org-wide scopes
 *  remain out of contract scope. */
export type MemoryScope = {
  readonly scopeId: string;
  readonly operatorId: string;
  readonly kind: "project" | "collection";
  readonly name: string;
  /** Collections may nest projects; null = top level. */
  readonly parentScopeId: string | null;
  readonly createdAt: string;
};

export type Zest = {
  /** Ratified VISIBLE text, verbatim (IUR-5). */
  readonly text: string;
  /** Proof anchor (V6): SHA-256 of the exact ratified visible text. */
  readonly ratifiedTextSha256: string;
  /** Reference to the ratifying human event. */
  readonly ratificationEventRef: string;
  readonly ratifiedAt: string;
  /** Monotonic per WorkItem. Core-assigned (V7). */
  readonly ratifiedVersion: number;
};

export type ModelResponseRecord = {
  readonly responseId: string;
  readonly proposedBy: "model" | "adapter";
  readonly content: string;
  /** Bounded REV_6 `shown` wire (MEM-4). Absent = no context passed. */
  readonly shownContext?: string;
  readonly createdAt: string;
};

export type MemoryPoint = {
  readonly memoryPointId: string;
  readonly workItemId: string;
  /** Single authoritative home of the zest (V5). */
  readonly zest: Zest;
  /** Backward lineage only (V1): written once at creation; the superseded
   *  record is never touched. */
  readonly supersedes: string | null;
  readonly modelResponses: readonly ModelResponseRecord[];
  readonly createdAt: string;
};

export type CurrentWorkingIntentPointer = {
  readonly operatorId: string;
  readonly workItemId: string;
  /** Points at a RATIFIED MemoryPoint only (MEM-6). */
  readonly memoryPointId: string;
  /** Moves only by a human act (MEM-8). Persists across sessions. */
  readonly setAt: string;
};

export type RecapResult = {
  readonly workItemId: string;
  readonly memoryPoints: readonly MemoryPoint[];
  /** Literal `true` (MEM-2): a recap can never be marked authoritative. */
  readonly isCandidate: true;
};

export type DeletionEvent = {
  readonly deletionEventId: string;
  readonly operatorId: string;
  /** Id only — content is gone (MEM-5 exception). */
  readonly deletedMemoryPointId: string;
  readonly deletedAt: string;
  readonly reason: "human_commanded";
};

/** MEM-9: adapter failure is unavailable — never fabricated data. */
export type RecapOutcome =
  | { readonly kind: "ok"; readonly recap: RecapResult }
  | { readonly kind: "unavailable"; readonly reason: string };
