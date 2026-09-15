/**
 * Governed-decision Portal API client (E4) — fresh, projection-only surface.
 *
 * This module is deliberately SELF-CONTAINED and shares no DTOs with the legacy
 * `client.ts`. It mirrors the E3 wire shapes 1:1 (projection / epistemic /
 * envelope from `src/governed-decision`), so the Portal renders exactly what the
 * kernel projects and invents nothing.
 *
 * Authority: NONE. This module only transmits requests and returns responses.
 *   - GET  /api/governed/decisions                  list threads
 *   - POST /api/governed/decisions                  create a draft (the machine's
 *                                                    proposal — no authority)
 *   - GET  /api/governed/decisions/:id              project one stored record
 *   - POST /api/governed/decisions/:threadId/ratify ratify (the sole human write)
 *
 * The governed routes are mounted opt-in (GOVERNED_PORTAL=1) and loopback-only on
 * the dev server; a 404/Failed fetch here means the surface is simply not enabled.
 */

const BASE = "/api/governed";

// ─── Wire DTOs (mirror src/governed-decision projection/epistemic/store) ──────

/** Gauge law: every section is connected, derived, or honestly unavailable. */
export type ProjectedSection =
  | { readonly stage: string; readonly status: "connected"; readonly display: string }
  | {
      readonly stage: string;
      readonly status: "derived";
      readonly display: string;
      readonly derivedFrom: readonly string[];
    }
  | { readonly stage: string; readonly status: "unavailable"; readonly reason: string };

export type GovernedDecisionProjection = {
  readonly recordId: string;
  readonly createdAt: string;
  readonly humanIntent: { readonly goal: string; readonly constraints: readonly string[] };
  readonly sections: readonly ProjectedSection[];
  readonly priorObservationRef: string | null;
};

export type EpistemicKind = "inference" | "hypothesis" | "prediction" | "outcome";

export type EpistemicStatus =
  | "DERIVED_NOT_CERTIFIED"
  | "CANDIDATE_ONLY"
  | "PROJECTED_NOT_OBSERVED"
  | "REALITY_OBSERVED"
  | "UNKNOWN";

export type EpistemicObject = {
  readonly kind: EpistemicKind;
  readonly status: EpistemicStatus;
  readonly statement?: string;
  readonly derivedFrom: readonly string[];
};

export type StoredKind = "draft" | "final";

export type StoredEnvelope = {
  readonly threadId: string;
  readonly kind: StoredKind;
  readonly storedAt: string;
  readonly supersedes: string | null;
};

/** Full payload returned by create / get / ratify. */
export type GovernedRecordPayload = {
  readonly envelope: StoredEnvelope;
  readonly projection: GovernedDecisionProjection;
  readonly epistemic: readonly EpistemicObject[];
};

export type RatificationDecision = "approved" | "rejected";

/** Read-model summary of one thread (draft + optional final). */
export type ThreadSummary = {
  readonly threadId: string;
  readonly goal: string;
  readonly draftRecordId: string | null;
  readonly finalRecordId: string | null;
  readonly ratifiedDecision: RatificationDecision | null;
  readonly createdAt: string;
};

export type ThreadListResponse = { readonly threads: readonly ThreadSummary[] };

// ─── Transport ────────────────────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Operations ───────────────────────────────────────────────────────────────

export function listThreads(): Promise<ThreadListResponse> {
  return getJson<ThreadListResponse>("/decisions");
}

export function getRecord(recordId: string): Promise<GovernedRecordPayload> {
  return getJson<GovernedRecordPayload>(`/decisions/${encodeURIComponent(recordId)}`);
}

export type CreateDraftInput = {
  readonly goal: string;
  readonly constraints?: readonly string[];
  /** Optional automatic-loop ingress: a prior recordId whose observation feeds this basis. */
  readonly from?: string;
};

export function createDraft(input: CreateDraftInput): Promise<GovernedRecordPayload> {
  const body: Record<string, unknown> = { goal: input.goal };
  if (input.constraints && input.constraints.length > 0) body["constraints"] = input.constraints;
  if (input.from && input.from.length > 0) body["from"] = input.from;
  return postJson<GovernedRecordPayload>("/decisions", body);
}

export function ratifyThread(
  threadId: string,
  decision: RatificationDecision,
): Promise<GovernedRecordPayload> {
  return postJson<GovernedRecordPayload>(
    `/decisions/${encodeURIComponent(threadId)}/ratify`,
    { decision },
  );
}
