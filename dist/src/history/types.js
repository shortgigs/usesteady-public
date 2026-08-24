/**
 * Phase 10B: History / Audit read-model types.
 *
 * ── Two-tier model (D1) ──────────────────────────────────────────────────────
 *
 *   Tier 1 — WorkflowHistorySummary
 *     Cheap. Reads only from ucp.workflow_run.v1 envelopes.
 *     No per-task chain resolution.
 *     Consumer: list views, CLI history command.
 *
 *   Tier 2 — WorkflowAuditRecord
 *     Expensive. Resolves session chains per task via byRoot index.
 *     Consumer: operator drill-down, incident investigation.
 *
 * ── SessionChain vs RunTimeline (D2) ─────────────────────────────────────────
 *
 *   SessionChain covers Phase 8/9 sessions: handoff → receipt | refused.
 *   RunTimeline  covers Phase 3/6 runs:     artifact → trace + replay.
 *   These are NOT merged. They are structurally incompatible chains.
 *
 * ── Live state excluded (D4) ─────────────────────────────────────────────────
 *
 *   No type in this module accepts a live WorkflowRun, WorkflowTask[],
 *   CursorSessionState, or ClaudeSessionState. All history reads from storeDir.
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   Zero. This module imports types only — no coordinator, no sessions,
 *   no execution layer. It is a pure read-only projection of the UCP store.
 */
export {};
//# sourceMappingURL=types.js.map