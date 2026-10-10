/**
 * FileMemoryAdapter — MEM.S2 persistence adapter.
 *
 * Dumb storage only (V7): validates nothing about ratification, decides
 * nothing. One JSON file ({storeDir}/memory.json) holds points, pointers
 * and deletion events. Writes are atomic (tmp + rename — live-run-store
 * house pattern): a crash mid-write leaves at most a stale .tmp file,
 * never a corrupt store.
 *
 * MEM-9 proof obligation: the entire MEM.S1 invariant suite must pass
 * unchanged over this adapter (tests/memory/memory.test.ts runs
 * per-adapter).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MemoryAdapter } from "./adapter.js";
import type {
  CurrentWorkingIntentPointer,
  DeletionEvent,
  MemoryPoint,
  MemoryScope,
  WorkItem,
} from "./types.js";

type MemoryDisk = {
  readonly points: readonly MemoryPoint[];
  readonly pointers: Readonly<Record<string, CurrentWorkingIntentPointer>>;
  readonly deletions: readonly DeletionEvent[];
  /** MEM.S3 — absent in MEM.S2 stores; loader defaults them (forward-safe). */
  readonly workItems?: Readonly<Record<string, WorkItem>>;
  readonly scopes?: Readonly<Record<string, MemoryScope>>;
};

const EMPTY: MemoryDisk = {
  points: [],
  pointers: {},
  deletions: [],
  workItems: {},
  scopes: {},
};

export class FileMemoryAdapter implements MemoryAdapter {
  constructor(private readonly storeDir: string) {}

  private get path(): string {
    return join(this.storeDir, "memory.json");
  }

  private load(): MemoryDisk {
    if (!existsSync(this.path)) return EMPTY;
    return JSON.parse(readFileSync(this.path, "utf8")) as MemoryDisk;
  }

  private save(disk: MemoryDisk): void {
    if (!existsSync(this.storeDir)) mkdirSync(this.storeDir, { recursive: true });
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(disk), "utf8");
    renameSync(tmp, this.path);
  }

  async writeMemoryPoint(point: MemoryPoint): Promise<void> {
    const disk = this.load();
    this.save({ ...disk, points: [...disk.points, point] });
  }

  async getMemoryPoints(workItemId: string): Promise<readonly MemoryPoint[]> {
    return this.load()
      .points.filter((p) => p.workItemId === workItemId)
      .sort((a, b) => a.zest.ratifiedVersion - b.zest.ratifiedVersion)
      .map(deepFreeze);
  }

  async getCurrentWorkingIntent(
    operatorId: string,
  ): Promise<CurrentWorkingIntentPointer | null> {
    const pointer = this.load().pointers[operatorId];
    return pointer !== undefined ? deepFreeze(pointer) : null;
  }

  async setCurrentWorkingIntent(
    pointer: CurrentWorkingIntentPointer,
  ): Promise<void> {
    const disk = this.load();
    this.save({
      ...disk,
      pointers: { ...disk.pointers, [pointer.operatorId]: pointer },
    });
  }

  async deleteMemoryPoint(memoryPointId: string): Promise<void> {
    const disk = this.load();
    this.save({
      ...disk,
      points: disk.points.filter((p) => p.memoryPointId !== memoryPointId),
    });
  }

  async writeDeletionEvent(event: DeletionEvent): Promise<void> {
    const disk = this.load();
    this.save({ ...disk, deletions: [...disk.deletions, event] });
  }

  async getDeletionEvents(
    operatorId: string,
  ): Promise<readonly DeletionEvent[]> {
    return this.load()
      .deletions.filter((d) => d.operatorId === operatorId)
      .map(deepFreeze);
  }

  async writeWorkItem(workItem: WorkItem): Promise<void> {
    const disk = this.load();
    this.save({
      ...disk,
      workItems: { ...disk.workItems, [workItem.workItemId]: workItem },
    });
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | null> {
    const workItem = this.load().workItems?.[workItemId];
    return workItem !== undefined ? deepFreeze(workItem) : null;
  }

  async getWorkItems(operatorId: string): Promise<readonly WorkItem[]> {
    return Object.values(this.load().workItems ?? {})
      .filter((w) => w.operatorId === operatorId)
      .map(deepFreeze);
  }

  async writeScope(scope: MemoryScope): Promise<void> {
    const disk = this.load();
    this.save({
      ...disk,
      scopes: { ...disk.scopes, [scope.scopeId]: scope },
    });
  }

  async getScopes(operatorId: string): Promise<readonly MemoryScope[]> {
    return Object.values(this.load().scopes ?? {})
      .filter((s) => s.operatorId === operatorId)
      .map(deepFreeze);
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
