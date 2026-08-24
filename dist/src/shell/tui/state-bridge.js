/**
 * TUI v1 — State bridge.
 *
 * Translates WorkflowRun → WorkflowState and writes to a PID-namespaced
 * temp file so the TUI process (or ink render loop) can poll it without
 * touching the coordinator or any execution logic.
 *
 * ── Invariants ────────────────────────────────────────────────────────────────
 *
 *   BR1: Read-only. Never mutates WorkflowRun.
 *   BR2: No imports from coordinator — only the WorkflowRun type.
 *   BR3: Temp file is PID-scoped: usesteady-tui-<pid>.json
 *        Prevents parallel runs stomping each other.
 *   BR4: setTuiState is always safe to call — failures are silently swallowed
 *        so a broken TUI never disrupts execution.
 *   BR5: "Blocked" status is derived from failureNote text for v1.
 *        This is non-frozen — replace with a typed signal when the coordinator
 *        exposes one.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
// ─── Temp file path (PID-scoped) ─────────────────────────────────────────────
const TUI_STATE_FILE = join(tmpdir(), `usesteady-tui-${process.pid}.json`);
// ─── Blocked reason ───────────────────────────────────────────────────────────
/**
 * Map run.display.failureNote → a short, non-technical reason string.
 * Only called when status === "Blocked". BR5 applies — non-frozen.
 *
 * Reason strings are intentionally short and human-level, not audit-level.
 * The detail (model-by-model breakdown) is deferred to ConsensusPanel v2.
 */
function deriveBlockedReason(run) {
    const note = (run.display.failureNote ?? "").toLowerCase();
    if (note.includes("scope"))
        return "Scope of the change is unclear";
    if (note.includes("no agreement") || note.includes("quorum"))
        return "Models did not agree on execution";
    if (note.includes("blocked") || note.includes("policy"))
        return "Models did not agree on execution";
    if (note.includes("exec") || note.includes("error"))
        return "Execution could not be completed";
    // Fallback: show the note truncated — better than nothing
    const raw = run.display.failureNote ?? "Task could not proceed";
    return raw.length > 72 ? raw.slice(0, 69) + "…" : raw;
}
// ─── Phase → status mapping ───────────────────────────────────────────────────
function deriveStatus(run) {
    switch (run.phase) {
        case "reviewing":
            return "Reviewing";
        case "completed":
            return "Completed";
        case "stopped":
            return "Stopped";
        case "task_failed": {
            // BR5: string-based detection for v1 — non-frozen.
            const note = (run.display.failureNote ?? "").toLowerCase();
            if (note.includes("blocked") || note.includes("policy") || note.includes("no agreement")) {
                return "Blocked";
            }
            return "Executing";
        }
        default:
            return "Executing";
    }
}
// ─── Task outcome → step status ──────────────────────────────────────────────
function deriveStepStatus(outcome) {
    switch (outcome) {
        case "accepted": return "completed";
        case "rejected": return "failed";
        case "stopped": return "failed";
        case "skipped": return "failed";
        case "skipped_by_intake": return "failed";
        case "pending": return "pending";
        case "planning_reviewed": return "planning_reviewed";
    }
}
// ─── WorkflowRun → WorkflowState ─────────────────────────────────────────────
function toWorkflowState(run, consensus) {
    const steps = run.tasks.map(task => ({
        id: task.index,
        description: task.spec.label ?? task.spec.input.slice(0, 48),
        status: deriveStepStatus(task.outcome),
    }));
    const status = deriveStatus(run);
    const showSystemWill = run.phase === "task_ready" || run.phase === "task_conflict";
    return {
        status,
        steps,
        currentStepId: run.currentIndex,
        ...(showSystemWill && run.display.headline
            ? { systemWill: { description: run.display.headline } }
            : {}),
        ...(status === "Blocked"
            ? { blockedReason: deriveBlockedReason(run) }
            : {}),
        // consensus present only when Blocked + multi-LLM data was supplied by caller
        ...(status === "Blocked" && consensus && consensus.length > 0
            ? { consensus }
            : {}),
        isComplete: run.phase === "completed" || run.phase === "stopped",
    };
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Write current WorkflowRun state to the TUI temp file.
 *
 * @param run       The current WorkflowRun (read-only, never mutated).
 * @param consensus Optional per-model consensus entries derived by the caller
 *                  from the consensus audit log. Shown only when status=Blocked.
 *
 * BR4: swallows all errors — never disrupts the execution loop.
 */
export function setTuiState(run, consensus) {
    try {
        const state = toWorkflowState(run, consensus);
        writeFileSync(TUI_STATE_FILE, JSON.stringify(state), "utf-8");
    }
    catch {
        // Silent — BR4
    }
}
/**
 * Read the current TUI state from the temp file.
 * Returns null if the file is absent or unparseable.
 */
export function readTuiState() {
    try {
        const raw = readFileSync(TUI_STATE_FILE, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=state-bridge.js.map