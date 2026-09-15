/**
 * Core write path — the write gate IS the ratification gate (MEM-1, V7).
 *
 * This module is the ONLY legal writer into a MemoryAdapter. It computes
 * every core-assigned field (ids, sha256 anchor, monotonic version,
 * timestamps); values arriving from surfaces, models or adapters are never
 * trusted for these fields.
 */

import { createHash, randomUUID } from "node:crypto";
import type { MemoryAdapter } from "./adapter.js";
import type { MemoryEvidenceEvent, MemoryEvidenceSink } from "./evidence.js";
import type {
  CurrentWorkingIntentPointer,
  DeletionEvent,
  MemoryPoint,
  MemoryScope,
  ModelResponseRecord,
  RecapOutcome,
  WorkItem,
} from "./types.js";

/** Provenance-only candidate input (MEM-2): content + optional shown wire. */
export type ModelResponseInput = {
  readonly proposedBy: "model" | "adapter";
  readonly content: string;
  readonly shownContext?: string;
};

export type RatificationInput = {
  readonly operatorId: string;
  readonly workItemId: string;
  /** The exact VISIBLE text the human ratified (IUR-5 anchor). */
  readonly ratifiedText: string;
  /** Reference to the ratifying human event. */
  readonly ratificationEventRef: string;
  readonly modelResponses?: readonly ModelResponseInput[];
};

export type RatifyOutcome =
  | { readonly kind: "ratified"; readonly point: MemoryPoint }
  | { readonly kind: "unavailable"; readonly reason: string };

/** MEM.S4: emit one evidence line for a gate act. Best-effort — never
 *  throws into the gate; with no sink, byte-identical (MEM-10). */
function emit(
  sink: MemoryEvidenceSink | undefined,
  event: MemoryEvidenceEvent,
): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // Evidence never blocks a memory write.
  }
}

/** MEM-1: called only at a human ratification event. Appends a new
 *  MemoryPoint with backward lineage (V1) — never edits a written record.
 *  MEM.S4: the human act is recorded as evidence at THIS gate, content-free,
 *  including the fail-closed path. */
export async function ratifyMemoryPoint(
  adapter: MemoryAdapter,
  input: RatificationInput,
  sink?: MemoryEvidenceSink,
): Promise<RatifyOutcome> {
  let existing: readonly MemoryPoint[];
  try {
    existing = await adapter.getMemoryPoints(input.workItemId);
  } catch (err) {
    const reason = describe(err);
    emit(sink, { kind: "write_unavailable", workItemId: input.workItemId, reason });
    return { kind: "unavailable", reason };
  }

  const latest = existing[existing.length - 1] ?? null;
  const now = new Date().toISOString();
  const point: MemoryPoint = {
    memoryPointId: randomUUID(),
    workItemId: input.workItemId,
    zest: {
      text: input.ratifiedText,
      ratifiedTextSha256: sha256(input.ratifiedText),
      ratificationEventRef: input.ratificationEventRef,
      ratifiedAt: now,
      ratifiedVersion: (latest?.zest.ratifiedVersion ?? 0) + 1,
    },
    supersedes: latest?.memoryPointId ?? null,
    modelResponses: (input.modelResponses ?? []).map(
      (r): ModelResponseRecord => ({
        responseId: randomUUID(),
        proposedBy: r.proposedBy,
        content: r.content,
        ...(r.shownContext !== undefined
          ? { shownContext: r.shownContext }
          : {}),
        createdAt: now,
      }),
    ),
    createdAt: now,
  };

  try {
    await adapter.writeMemoryPoint(point);
    // MEM.S3: maintain the WorkItem index record. latestRatifiedPointId is a
    // moving reference (V5), updated only here — at the human ratification
    // act. History (the points) is untouched (MEM-5).
    const existing2 = await adapter.getWorkItem(input.workItemId);
    const workItem: WorkItem = existing2
      ? { ...existing2, latestRatifiedPointId: point.memoryPointId }
      : {
          workItemId: input.workItemId,
          operatorId: input.operatorId,
          createdAt: now,
          latestRatifiedPointId: point.memoryPointId,
          scopeId: null,
        };
    await adapter.writeWorkItem(workItem);
  } catch (err) {
    const reason = describe(err);
    emit(sink, { kind: "write_unavailable", workItemId: input.workItemId, reason });
    return { kind: "unavailable", reason };
  }
  emit(sink, {
    kind: "ratified",
    workItemId: point.workItemId,
    memoryPointId: point.memoryPointId,
    ratifiedTextSha256: point.zest.ratifiedTextSha256,
    ratificationEventRef: point.zest.ratificationEventRef,
    ratifiedVersion: point.zest.ratifiedVersion,
    supersedes: point.supersedes,
  });
  return { kind: "ratified", point };
}

// ── MEM.S3: hierarchy — scopes and assignment are HUMAN acts, zero
//    authority. A scope never routes anything (MEM-6); it organizes recap. ──

export type ScopeOutcome =
  | { readonly kind: "created"; readonly scope: MemoryScope }
  | { readonly kind: "rejected"; readonly reason: "invalid_parent" }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Create a project or collection for the operator. Only a collection may
 *  parent; a project cannot contain scopes. */
export async function createScope(
  adapter: MemoryAdapter,
  operatorId: string,
  kind: "project" | "collection",
  name: string,
  parentScopeId: string | null,
): Promise<ScopeOutcome> {
  try {
    if (parentScopeId !== null) {
      const scopes = await adapter.getScopes(operatorId);
      const parent = scopes.find((s) => s.scopeId === parentScopeId);
      if (!parent || parent.kind !== "collection") {
        return { kind: "rejected", reason: "invalid_parent" };
      }
    }
    const scope: MemoryScope = {
      scopeId: randomUUID(),
      operatorId,
      kind,
      name,
      parentScopeId,
      createdAt: new Date().toISOString(),
    };
    await adapter.writeScope(scope);
    return { kind: "created", scope };
  } catch (err) {
    return { kind: "unavailable", reason: describe(err) };
  }
}

export type AssignScopeOutcome =
  | { readonly kind: "assigned"; readonly workItem: WorkItem }
  | {
      readonly kind: "rejected";
      readonly reason: "unknown_work_item" | "unknown_scope";
    }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Assign a work item to a scope — a human act. Passing null unscopes. */
export async function assignWorkItemScope(
  adapter: MemoryAdapter,
  operatorId: string,
  workItemId: string,
  scopeId: string | null,
): Promise<AssignScopeOutcome> {
  try {
    const workItem = await adapter.getWorkItem(workItemId);
    if (!workItem || workItem.operatorId !== operatorId) {
      return { kind: "rejected", reason: "unknown_work_item" };
    }
    if (scopeId !== null) {
      const scopes = await adapter.getScopes(operatorId);
      if (!scopes.some((s) => s.scopeId === scopeId)) {
        return { kind: "rejected", reason: "unknown_scope" };
      }
    }
    const updated: WorkItem = { ...workItem, scopeId };
    await adapter.writeWorkItem(updated);
    return { kind: "assigned", workItem: updated };
  } catch (err) {
    return { kind: "unavailable", reason: describe(err) };
  }
}

/** MEM-2: recall only as a visible, rejectable candidate.
 *  MEM-9: adapter failure is unavailable — never fabricated data. */
export async function recapWorkItem(
  adapter: MemoryAdapter,
  workItemId: string,
): Promise<RecapOutcome> {
  try {
    const memoryPoints = await adapter.getMemoryPoints(workItemId);
    return { kind: "ok", recap: { workItemId, memoryPoints, isCandidate: true } };
  } catch (err) {
    return { kind: "unavailable", reason: describe(err) };
  }
}

export type PointerOutcome =
  | { readonly kind: "set"; readonly pointer: CurrentWorkingIntentPointer }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: "not_ratified" };

/** MEM-6 / MEM-8: pointer moves only by a human act and may only reference
 *  a ratified MemoryPoint that actually exists. */
export async function setCurrentWorkingIntent(
  adapter: MemoryAdapter,
  operatorId: string,
  workItemId: string,
  memoryPointId: string,
  sink?: MemoryEvidenceSink,
): Promise<PointerOutcome> {
  try {
    const points = await adapter.getMemoryPoints(workItemId);
    if (!points.some((p) => p.memoryPointId === memoryPointId)) {
      return { kind: "rejected", reason: "not_ratified" };
    }
    const pointer: CurrentWorkingIntentPointer = {
      operatorId,
      workItemId,
      memoryPointId,
      setAt: new Date().toISOString(),
    };
    await adapter.setCurrentWorkingIntent(pointer);
    emit(sink, { kind: "pointer_moved", operatorId, workItemId, memoryPointId });
    return { kind: "set", pointer };
  } catch (err) {
    return { kind: "unavailable", reason: describe(err) };
  }
}

export type DeleteOutcome =
  | { readonly kind: "deleted"; readonly event: DeletionEvent }
  | { readonly kind: "unavailable"; readonly reason: string };

/** MEM-5 exception: human-commanded privacy deletion physically removes the
 *  record; the DeletionEvent records the act — never the content. */
export async function deleteMemoryPointForPrivacy(
  adapter: MemoryAdapter,
  operatorId: string,
  memoryPointId: string,
  sink?: MemoryEvidenceSink,
): Promise<DeleteOutcome> {
  const event: DeletionEvent = {
    deletionEventId: randomUUID(),
    operatorId,
    deletedMemoryPointId: memoryPointId,
    deletedAt: new Date().toISOString(),
    reason: "human_commanded",
  };
  try {
    await adapter.deleteMemoryPoint(memoryPointId);
    await adapter.writeDeletionEvent(event);
  } catch (err) {
    return { kind: "unavailable", reason: describe(err) };
  }
  // MEM.S4: the deletion act is evidence; the content is gone. Proof
  // outlives content — the line carries ids only.
  emit(sink, {
    kind: "deleted",
    operatorId,
    deletedMemoryPointId: memoryPointId,
    deletionEventId: event.deletionEventId,
  });
  return { kind: "deleted", event };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
