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
import type { WorkflowRun } from "../../workflow/types.js";
import type { WorkflowState, TuiConsensusEntry } from "./types.js";
/**
 * Write current WorkflowRun state to the TUI temp file.
 *
 * @param run       The current WorkflowRun (read-only, never mutated).
 * @param consensus Optional per-model consensus entries derived by the caller
 *                  from the consensus audit log. Shown only when status=Blocked.
 *
 * BR4: swallows all errors — never disrupts the execution loop.
 */
export declare function setTuiState(run: WorkflowRun, consensus?: readonly TuiConsensusEntry[]): void;
/**
 * Read the current TUI state from the temp file.
 * Returns null if the file is absent or unparseable.
 */
export declare function readTuiState(): WorkflowState | null;
//# sourceMappingURL=state-bridge.d.ts.map