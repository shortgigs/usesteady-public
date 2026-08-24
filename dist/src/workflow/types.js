/**
 * Phase 9C: Workflow types.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Defines the data model for multi-session workflows: spec (what H authors
 *   before a run) and run state (what the coordinator manages during execution).
 *
 * ── Design constraints (from Phase 9B) ────────────────────────────────────────
 *
 *   - WorkflowSpec is fixed at creation time. The coordinator never modifies it.
 *   - WorkflowRun is immutable. Every transition returns a new object.
 *   - currentSession carries the live session state between coordinator steps.
 *   - Tasks track per-task outcomes and retry counts.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────────
 *
 *   - Output forwarding between tasks (Phase 9D)
 *   - Parallel execution (Phase 9D+)
 *   - Batch approval (explicitly deferred, W2)
 *   - OCD override that loosens policy (W6)
 *
 * See: docs/phase-9b-workflow-design.md — full design record
 *      docs/phase-9c-baseline.md         — implementation freeze record
 */
export {};
//# sourceMappingURL=types.js.map