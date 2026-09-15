/**
 * MEM.S5 — Supabase Postgres adapter (USESTEADY_MEMORY_CONTRACT_V0_REV_2).
 *
 * Durable production backend behind the same MemoryAdapter seam (MEM-9).
 * Dumb storage discipline (V7) unchanged: this adapter validates nothing
 * about ratification and decides nothing — every id, hash, version and
 * timestamp arrives already computed by the write gate. Timestamps are
 * stored as text so core-assigned ISO strings round-trip verbatim.
 *
 * Transport is PostgREST over fetch (no new runtime dependency). Any
 * failure — network, auth, non-2xx — throws, which the gate and routes
 * surface as `unavailable` (MEM-9: never fabricated data).
 *
 * The evidence ledger table (memory_evidence) is append-only AT THE
 * DATABASE: a trigger rejects UPDATE and DELETE, which is a stronger
 * guarantee than the file sink ever had.
 */

import type { MemoryAdapter } from "./adapter.js";
import type {
  CurrentWorkingIntentPointer,
  DeletionEvent,
  MemoryPoint,
  MemoryScope,
  ModelResponseRecord,
  WorkItem,
  Zest,
} from "./types.js";
import type {
  MemoryEvidenceEvent,
  MemoryEvidenceLine,
  MemoryEvidenceSink,
} from "./evidence.js";

export type SupabaseMemoryConfig = {
  /** Project base URL, e.g. https://xyz.supabase.co */
  readonly url: string;
  readonly serviceRoleKey: string;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
};

type Row = Record<string, unknown>;

class SupabaseRest {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SupabaseMemoryConfig) {
    this.base = config.url.replace(/\/$/, "") + "/rest/v1";
    this.key = config.serviceRoleKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async select(table: string, query: string): Promise<readonly Row[]> {
    const res = await this.fetchImpl(`${this.base}/${table}?${query}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`supabase select ${table} failed: ${res.status}`);
    }
    return (await res.json()) as Row[];
  }

  async insert(table: string, row: Row, upsert = false): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/${table}`, {
      method: "POST",
      headers: this.headers({
        Prefer: upsert
          ? "resolution=merge-duplicates,return=minimal"
          : "return=minimal",
      }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      throw new Error(`supabase insert ${table} failed: ${res.status}`);
    }
  }

  async delete(table: string, query: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/${table}?${query}`, {
      method: "DELETE",
      headers: this.headers({ Prefer: "return=minimal" }),
    });
    if (!res.ok) {
      throw new Error(`supabase delete ${table} failed: ${res.status}`);
    }
  }
}

const eq = (column: string, value: string): string =>
  `${column}=eq.${encodeURIComponent(value)}`;

export class SupabaseMemoryAdapter implements MemoryAdapter {
  private readonly rest: SupabaseRest;

  constructor(config: SupabaseMemoryConfig) {
    this.rest = new SupabaseRest(config);
  }

  async writeMemoryPoint(point: MemoryPoint): Promise<void> {
    await this.rest.insert("memory_points", {
      memory_point_id: point.memoryPointId,
      work_item_id: point.workItemId,
      zest: point.zest,
      supersedes: point.supersedes,
      model_responses: point.modelResponses,
      created_at: point.createdAt,
    });
  }

  async getMemoryPoints(workItemId: string): Promise<readonly MemoryPoint[]> {
    const rows = await this.rest.select(
      "memory_points",
      eq("work_item_id", workItemId),
    );
    return rows
      .map(
        (r): MemoryPoint => ({
          memoryPointId: r["memory_point_id"] as string,
          workItemId: r["work_item_id"] as string,
          zest: r["zest"] as Zest,
          supersedes: (r["supersedes"] as string | null) ?? null,
          modelResponses: (r["model_responses"] ??
            []) as readonly ModelResponseRecord[],
          createdAt: r["created_at"] as string,
        }),
      )
      .sort((a, b) => a.zest.ratifiedVersion - b.zest.ratifiedVersion);
  }

  async getCurrentWorkingIntent(
    operatorId: string,
  ): Promise<CurrentWorkingIntentPointer | null> {
    const rows = await this.rest.select(
      "memory_pointers",
      eq("operator_id", operatorId),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      operatorId: r["operator_id"] as string,
      workItemId: r["work_item_id"] as string,
      memoryPointId: r["memory_point_id"] as string,
      setAt: r["set_at"] as string,
    };
  }

  async setCurrentWorkingIntent(
    pointer: CurrentWorkingIntentPointer,
  ): Promise<void> {
    await this.rest.insert(
      "memory_pointers",
      {
        operator_id: pointer.operatorId,
        work_item_id: pointer.workItemId,
        memory_point_id: pointer.memoryPointId,
        set_at: pointer.setAt,
      },
      true,
    );
  }

  async deleteMemoryPoint(memoryPointId: string): Promise<void> {
    await this.rest.delete(
      "memory_points",
      eq("memory_point_id", memoryPointId),
    );
  }

  async writeDeletionEvent(event: DeletionEvent): Promise<void> {
    await this.rest.insert("memory_deletion_events", {
      deletion_event_id: event.deletionEventId,
      operator_id: event.operatorId,
      deleted_memory_point_id: event.deletedMemoryPointId,
      deleted_at: event.deletedAt,
      reason: event.reason,
    });
  }

  async getDeletionEvents(
    operatorId: string,
  ): Promise<readonly DeletionEvent[]> {
    const rows = await this.rest.select(
      "memory_deletion_events",
      eq("operator_id", operatorId),
    );
    return rows.map(
      (r): DeletionEvent => ({
        deletionEventId: r["deletion_event_id"] as string,
        operatorId: r["operator_id"] as string,
        deletedMemoryPointId: r["deleted_memory_point_id"] as string,
        deletedAt: r["deleted_at"] as string,
        reason: r["reason"] as "human_commanded",
      }),
    );
  }

  async writeWorkItem(workItem: WorkItem): Promise<void> {
    await this.rest.insert(
      "memory_work_items",
      {
        work_item_id: workItem.workItemId,
        operator_id: workItem.operatorId,
        created_at: workItem.createdAt,
        latest_ratified_point_id: workItem.latestRatifiedPointId,
        scope_id: workItem.scopeId,
      },
      true,
    );
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | null> {
    const rows = await this.rest.select(
      "memory_work_items",
      eq("work_item_id", workItemId),
    );
    const r = rows[0];
    if (!r) return null;
    return rowToWorkItem(r);
  }

  async getWorkItems(operatorId: string): Promise<readonly WorkItem[]> {
    const rows = await this.rest.select(
      "memory_work_items",
      eq("operator_id", operatorId),
    );
    return rows.map(rowToWorkItem);
  }

  async writeScope(scope: MemoryScope): Promise<void> {
    await this.rest.insert("memory_scopes", {
      scope_id: scope.scopeId,
      operator_id: scope.operatorId,
      kind: scope.kind,
      name: scope.name,
      parent_scope_id: scope.parentScopeId,
      created_at: scope.createdAt,
    });
  }

  async getScopes(operatorId: string): Promise<readonly MemoryScope[]> {
    const rows = await this.rest.select(
      "memory_scopes",
      eq("operator_id", operatorId),
    );
    return rows.map(
      (r): MemoryScope => ({
        scopeId: r["scope_id"] as string,
        operatorId: r["operator_id"] as string,
        kind: r["kind"] as "project" | "collection",
        name: r["name"] as string,
        parentScopeId: (r["parent_scope_id"] as string | null) ?? null,
        createdAt: r["created_at"] as string,
      }),
    );
  }
}

function rowToWorkItem(r: Row): WorkItem {
  return {
    workItemId: r["work_item_id"] as string,
    operatorId: r["operator_id"] as string,
    createdAt: r["created_at"] as string,
    latestRatifiedPointId:
      (r["latest_ratified_point_id"] as string | null) ?? null,
    scopeId: (r["scope_id"] as string | null) ?? null,
  };
}

// ── MEM.S4 evidence on Postgres ─────────────────────────────────────────────

/** Append-only evidence sink writing to the memory_evidence table.
 *  Best-effort and fire-and-forget: never throws into the write gate. */
export function supabaseMemoryEvidenceSink(
  config: SupabaseMemoryConfig,
): MemoryEvidenceSink {
  const rest = new SupabaseRest(config);
  return (event: MemoryEvidenceEvent) => {
    const e = event as Record<string, unknown>;
    const row: Row = {
      ts: new Date().toISOString(),
      kind: event.kind,
      work_item_id: e["workItemId"] ?? null,
      operator_id: e["operatorId"] ?? null,
      memory_point_id: e["memoryPointId"] ?? null,
      deleted_memory_point_id: e["deletedMemoryPointId"] ?? null,
      deletion_event_id: e["deletionEventId"] ?? null,
      ratified_text_sha256: e["ratifiedTextSha256"] ?? null,
      ratification_event_ref: e["ratificationEventRef"] ?? null,
      ratified_version: e["ratifiedVersion"] ?? null,
      supersedes: e["supersedes"] ?? null,
      reason: e["reason"] ?? null,
    };
    rest.insert("memory_evidence", row).catch(() => {
      // Evidence is best-effort: never propagate into the write gate.
    });
  };
}

/** Read the evidence ledger for one work item, oldest first. Unreachable
 *  backend throws (surfaced as unavailable — never fabricated). */
export async function readSupabaseMemoryEvidence(
  config: SupabaseMemoryConfig,
  workItemId: string,
): Promise<readonly MemoryEvidenceLine[]> {
  const rest = new SupabaseRest(config);
  const rows = await rest.select(
    "memory_evidence",
    `${eq("work_item_id", workItemId)}&order=id.asc`,
  );
  return rows.map((r) => {
    const line: Record<string, unknown> = { ts: r["ts"], kind: r["kind"] };
    const map: Record<string, string> = {
      work_item_id: "workItemId",
      operator_id: "operatorId",
      memory_point_id: "memoryPointId",
      deleted_memory_point_id: "deletedMemoryPointId",
      deletion_event_id: "deletionEventId",
      ratified_text_sha256: "ratifiedTextSha256",
      ratification_event_ref: "ratificationEventRef",
      ratified_version: "ratifiedVersion",
      supersedes: "supersedes",
      reason: "reason",
    };
    for (const [col, field] of Object.entries(map)) {
      if (r[col] !== null && r[col] !== undefined) line[field] = r[col];
    }
    // `supersedes: null` is meaningful on ratified lines (first version).
    if (r["kind"] === "ratified" && line["supersedes"] === undefined) {
      line["supersedes"] = null;
    }
    return line as unknown as MemoryEvidenceLine;
  });
}
