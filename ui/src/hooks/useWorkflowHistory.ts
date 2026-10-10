/**
 * Phase 11A-Web: useWorkflowHistory + useWorkflowAudit hooks.
 *
 * useWorkflowHistory: loads Tier 1 summaries (cheap).
 * useWorkflowAudit:   loads Tier 2 audit record on demand (expensive).
 *
 * UI-W4: reads persisted records only, never live state.
 * No global state manager — local React state only.
 */

import { useState, useEffect, useCallback } from "react";
import { listWorkflowHistory, getWorkflowAudit, getConsensusSummary } from "../api/client.js";
import { workflowHistoryToListItem, workflowAuditToDetailView } from "../adapters/history.js";
import type { HistoryListItem, AuditDetailView } from "../adapters/history.js";
import type { ConsensusAuditSummary } from "../api/types.js";

// ─── Tier 1: history list ─────────────────────────────────────────────────────

export type HistoryListState = {
  items:   readonly HistoryListItem[];
  loading: boolean;
  error:   string | null;
  refresh: () => void;
};

export function useWorkflowHistory(): HistoryListState {
  const [items,   setItems]   = useState<readonly HistoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summaries = await listWorkflowHistory();
      setItems(summaries.map(workflowHistoryToListItem));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { items, loading, error, refresh: load };
}

// ─── Tier 2: audit record ─────────────────────────────────────────────────────

export type AuditState = {
  detail:  AuditDetailView | null;
  loading: boolean;
  error:   string | null;
};

export function useWorkflowAudit(runId: string | null): AuditState {
  const [detail,  setDetail]  = useState<AuditDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!runId) { setDetail(null); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getWorkflowAudit(runId)
      .then(record => {
        if (!cancelled) setDetail(workflowAuditToDetailView(record));
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [runId]);

  return { detail, loading, error };
}

// ─── Consensus summary ────────────────────────────────────────────────────────

export type ConsensusSummaryState = {
  items:   readonly ConsensusAuditSummary[];
  loading: boolean;
  error:   string | null;
};

/** Loads the most recent N consensus audit summaries.
 *  Returns empty items when multi-LLM mode is inactive. */
export function useConsensusSummary(limit = 10): ConsensusSummaryState {
  const [items,   setItems]   = useState<readonly ConsensusAuditSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getConsensusSummary(limit)
      .then(data => { if (!cancelled) setItems(data); })
      .catch(err  => { if (!cancelled) setError((err as Error).message); })
      .finally(()  => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [limit]);

  return { items, loading, error };
}
