/**
 * Phase 11A-Web: Typed API client.
 *
 * All HTTP calls to the API server go through this module.
 * Components and hooks never call fetch() directly.
 *
 * Authority: none. This module only transmits requests and returns responses.
 * All authority stays in the server-side frozen coordinator layer.
 */

import type {
  RunResponse,
  StartResponse,
  WorkflowSpec,
  WorkflowHistorySummary,
  WorkflowAuditRecord,
  ExecutionStep,
  SessionStepsResponse,
  DecisionResponse,
  SessionStats,
  SessionTimelineResponse,
  UndoResponse,
  ConsensusAuditSummary,
  ProviderStatusResponse,
  ConfirmedUnderstandingV1,
} from "./types.js";

const BASE = "/api";

/**
 * Lightweight connectivity probe against the deploy health endpoint.
 * Returns true only when the API server is genuinely reachable and reports ok.
 * Used by the shell StatusBar to render a truthful connection indicator —
 * never a fabricated "Ready" state. Authority: none (transport only).
 */
export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, signal ? { signal } : undefined);
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Workflow run APIs ────────────────────────────────────────────────────────

export function startWorkflow(
  spec:               WorkflowSpec,
  workspaceRoot?:     string,
  mode?:              "normal" | "break_glass",
  breakGlassReason?:  string,
  clarifyAnswer?:     string,
): Promise<StartResponse> {
  return post<StartResponse>("/workflow/start", {
    spec,
    workspaceRoot,
    ...(mode              ? { mode }              : {}),
    ...(breakGlassReason  ? { breakGlassReason }  : {}),
    ...(clarifyAnswer     ? { clarifyAnswer }     : {}),
  });
}

export function getWorkflowRun(runId: string): Promise<RunResponse> {
  return get<RunResponse>(`/workflow/${runId}`);
}

export function confirmWorkflow(runId: string, yes: boolean): Promise<RunResponse> {
  return post<RunResponse>(`/workflow/${runId}/confirm`, { yes });
}

export function confirmUnderstanding(
  runId: string,
  confirmedUnderstanding: ConfirmedUnderstandingV1,
): Promise<RunResponse> {
  return post<RunResponse>(`/workflow/${runId}/confirm-understanding`, { confirmedUnderstanding });
}

export function chooseWorkflow(runId: string, idx: number): Promise<RunResponse> {
  return post<RunResponse>(`/workflow/${runId}/choose`, { idx });
}

// ─── History APIs ─────────────────────────────────────────────────────────────

export function listWorkflowHistory(): Promise<WorkflowHistorySummary[]> {
  return get<WorkflowHistorySummary[]>("/history");
}

export function getWorkflowAudit(runId: string): Promise<WorkflowAuditRecord> {
  return get<WorkflowAuditRecord>(`/history/${runId}`);
}

// ─── Consensus audit APIs ─────────────────────────────────────────────────────

/** Returns the most recent N consensus audit summaries, newest first.
 *  Returns [] when multi-LLM mode is inactive or no runs have occurred yet. */
export function getConsensusSummary(limit = 10): Promise<ConsensusAuditSummary[]> {
  return get<ConsensusAuditSummary[]>(`/consensus/recent?limit=${limit}`);
}

// ─── Execution Control APIs (Phase 1) ────────────────────────────────────────

export function getSessionSteps(
  sessionId: string,
): Promise<SessionStepsResponse> {
  return get<SessionStepsResponse>(`/execution/session/${sessionId}/steps`);
}

export function startExecutionSession(
  workspacePath: string,
): Promise<{ sessionId: string }> {
  return post<{ sessionId: string }>("/execution/start", { workspacePath });
}

export function addExecutionSteps(
  sessionId: string,
  steps:     ExecutionStep[],
): Promise<{ success: boolean }> {
  return post<{ success: boolean }>("/execution/steps", { sessionId, steps });
}

export function recordStepDecision(
  stepId:   string,
  decision: "approved" | "rejected",
): Promise<DecisionResponse> {
  return post<DecisionResponse>("/execution/step/decision", { stepId, decision });
}

export function getSessionStats(sessionId: string): Promise<SessionStats> {
  return get<SessionStats>(`/execution/session/${sessionId}/stats`);
}

export function getSessionTimeline(sessionId: string): Promise<SessionTimelineResponse> {
  return get<SessionTimelineResponse>(`/execution/session/${sessionId}/timeline`);
}

/**
 * Reverts the most-recently approved step back to pending.
 * One step per call — the caller controls how many times to invoke.
 */
export function undoLastApproval(sessionId: string): Promise<UndoResponse> {
  return post<UndoResponse>(`/execution/session/${sessionId}/undo`, {});
}

// ─── Provider status (#150) ──────────────────────────────────────────────────

/**
 * Returns configured/live state for every registered AI provider.
 * Used by WorkflowBuilder to decide the pre-flight credential gate:
 *   live  + missing → BLOCK (red banner, disabled Start)
 *   demo  + missing → allow, with a subtle demo-mode indicator
 *   configured      → proceed silently
 *
 * Secrets never cross this boundary — the response contains only presence
 * booleans, never the key itself.
 */
export function getProviderStatus(): Promise<ProviderStatusResponse> {
  return get<ProviderStatusResponse>("/providers/status");
}

// ─── Presence attribution failure sink (S2) ──────────────────────────────────

/**
 * Reports a present fact that rendered with no derivable attribution -- a
 * real-traffic violation of the certified presence-attribution property
 * (PMC-A/PMC-C). Write-only and best-effort: it never throws, blocks, or alters
 * the UI. This is certification evidence (a tripwire), NOT product telemetry.
 *
 * Governed by USESTEADY_PRESENCE_ATTRIBUTION_UI_IMPLEMENTATION_V1 (S2).
 */
export function reportUnattributedPresenceFact(payload: {
  readonly input: string;
  readonly field: string;
  readonly fact: string;
  readonly step?: number;
}): void {
  fetch(`${BASE}/presence-attribution/unattributed`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  }).catch(() => {
    /* best-effort, write-only, zero authority: never surface to the user */
  });
}
