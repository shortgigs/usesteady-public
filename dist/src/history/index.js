/**
 * Phase 10B: History / Audit — public API.
 *
 * ── What this module exports ──────────────────────────────────────────────────
 *
 *   Types     — WorkflowHistorySummary, WorkflowAuditRecord, SessionChain, etc.
 *   Tier 1    — getWorkflowHistories(storeDir)
 *   Tier 2    — getWorkflowAuditRecord(storeDir, workflowRunId)
 *   Internals — buildSessionChain (exposed for testing and advanced consumers)
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   Zero. The history module is entirely read-only.
 *   It imports from src/ucp/persistence/ only.
 *   It accepts storeDir strings — never live WorkflowRun objects.
 *
 * ── Consumer pattern ──────────────────────────────────────────────────────────
 *
 *   // Tier 1 — list all completed/stopped runs (cheap):
 *   const summaries = getWorkflowHistories(storeDir);
 *   for (const s of summaries) { ... s.workflowName, s.finalOutcome, s.tasks ... }
 *
 *   // Tier 2 — full provenance for one run (expensive):
 *   const audit = getWorkflowAuditRecord(storeDir, workflowRunId);
 *   if (audit) {
 *     for (const t of audit.tasks) {
 *       if (t.session?.cursorReceipt) { ... }
 *       if (t.session?.cursorRefused) { ... }
 *     }
 *   }
 *
 * See: docs/phase-10a-history-audit-design.md — design record
 *      docs/phase-10b-baseline.md             — implementation freeze
 */
// ─── Tier 1 ───────────────────────────────────────────────────────────────────
export { getWorkflowHistories } from "./workflow-history.js";
// ─── Tier 2 ───────────────────────────────────────────────────────────────────
export { getWorkflowAuditRecord } from "./workflow-history.js";
// ─── Internal (exposed for testing + advanced consumers) ──────────────────────
export { buildSessionChain } from "./session-chain.js";
//# sourceMappingURL=index.js.map