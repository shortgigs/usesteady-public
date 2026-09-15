/**
 * MemoryAdapter — dumb storage boundary (MEM-9, V7).
 *
 * Adapters validate nothing about ratification and decide nothing. Only the
 * core ratification path (gate.ts) may invoke writes. Core-assigned fields
 * (ids, hashes, versions, timestamps) arrive already computed.
 */

import type {
  CurrentWorkingIntentPointer,
  DeletionEvent,
  MemoryPoint,
  MemoryScope,
  WorkItem,
} from "./types.js";

export interface MemoryAdapter {
  writeMemoryPoint(point: MemoryPoint): Promise<void>;
  getMemoryPoints(workItemId: string): Promise<readonly MemoryPoint[]>;
  getCurrentWorkingIntent(
    operatorId: string,
  ): Promise<CurrentWorkingIntentPointer | null>;
  setCurrentWorkingIntent(pointer: CurrentWorkingIntentPointer): Promise<void>;
  /** MEM-5 exception path: physically removes content. Core writes the
   *  DeletionEvent. */
  deleteMemoryPoint(memoryPointId: string): Promise<void>;
  writeDeletionEvent(event: DeletionEvent): Promise<void>;
  getDeletionEvents(operatorId: string): Promise<readonly DeletionEvent[]>;

  // ── MEM.S3: hierarchy (index records — NOT history; MEM-5 applies to
  //    memory points, while WorkItem.latestRatifiedPointId and the pointer
  //    move by human acts) ──
  writeWorkItem(workItem: WorkItem): Promise<void>;
  getWorkItem(workItemId: string): Promise<WorkItem | null>;
  getWorkItems(operatorId: string): Promise<readonly WorkItem[]>;
  writeScope(scope: MemoryScope): Promise<void>;
  getScopes(operatorId: string): Promise<readonly MemoryScope[]>;
}

/** MEM.S1 reference adapter. Stored records are frozen — the adapter cannot
 *  mutate history even by accident (MEM-5). */
export class InMemoryMemoryAdapter implements MemoryAdapter {
  private readonly points = new Map<string, MemoryPoint>();
  private readonly pointers = new Map<string, CurrentWorkingIntentPointer>();
  private readonly deletions: DeletionEvent[] = [];
  private readonly workItems = new Map<string, WorkItem>();
  private readonly scopes = new Map<string, MemoryScope>();

  async writeMemoryPoint(point: MemoryPoint): Promise<void> {
    this.points.set(point.memoryPointId, deepFreeze(point));
  }

  async getMemoryPoints(workItemId: string): Promise<readonly MemoryPoint[]> {
    return [...this.points.values()]
      .filter((p) => p.workItemId === workItemId)
      .sort((a, b) => a.zest.ratifiedVersion - b.zest.ratifiedVersion);
  }

  async getCurrentWorkingIntent(
    operatorId: string,
  ): Promise<CurrentWorkingIntentPointer | null> {
    return this.pointers.get(operatorId) ?? null;
  }

  async setCurrentWorkingIntent(
    pointer: CurrentWorkingIntentPointer,
  ): Promise<void> {
    this.pointers.set(pointer.operatorId, deepFreeze(pointer));
  }

  async deleteMemoryPoint(memoryPointId: string): Promise<void> {
    this.points.delete(memoryPointId);
  }

  async writeDeletionEvent(event: DeletionEvent): Promise<void> {
    this.deletions.push(deepFreeze(event));
  }

  async getDeletionEvents(
    operatorId: string,
  ): Promise<readonly DeletionEvent[]> {
    return this.deletions.filter((d) => d.operatorId === operatorId);
  }

  async writeWorkItem(workItem: WorkItem): Promise<void> {
    this.workItems.set(workItem.workItemId, deepFreeze(workItem));
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | null> {
    return this.workItems.get(workItemId) ?? null;
  }

  async getWorkItems(operatorId: string): Promise<readonly WorkItem[]> {
    return [...this.workItems.values()].filter(
      (w) => w.operatorId === operatorId,
    );
  }

  async writeScope(scope: MemoryScope): Promise<void> {
    this.scopes.set(scope.scopeId, deepFreeze(scope));
  }

  async getScopes(operatorId: string): Promise<readonly MemoryScope[]> {
    return [...this.scopes.values()].filter(
      (s) => s.operatorId === operatorId,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
