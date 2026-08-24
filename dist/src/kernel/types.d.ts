/**
 * Kernel v1 — deterministic replay artifact types.
 *
 * Scope (PR-K1, locked):
 *   - artifact.ir      = existing WorkflowSpec JSON (reused verbatim, no adapter)
 *   - artifact.result  = deterministic summary only (no stdout/stderr/exitCode/paths/timestamps)
 *   - artifact.checksum = sha256(stableStringify({ ir, result }))
 *   - No wall-clock time, no randomness, no runId, no workspaceRoot inside the hash input.
 *
 * This module is intentionally independent of src/ucp/. It reuses the pure
 * stableStringify/sha256 helpers from ucp/hashes.ts (pure utilities, no engine
 * coupling) but does not participate in the UCP envelope protocol.
 */
import type { WorkflowSpec } from "../workflow/types.js";
export type KernelResult = {
    readonly success: boolean;
    readonly error: string | null;
    readonly executed_steps: number;
    readonly failed_at_step: number | null;
    readonly total_steps: number;
};
export type KernelArtifact = {
    readonly version: "kernel.v1";
    readonly ir: WorkflowSpec;
    readonly result: KernelResult;
    readonly checksum: string;
};
export type ReplayVerdict = {
    readonly replay: "match" | "mismatch";
    readonly original_checksum: string;
    readonly new_checksum: string;
};
export type ExecutionReplayVerdict = {
    readonly replay: "match" | "mismatch";
    readonly mode: "execute";
    readonly original_checksum: string;
    readonly new_checksum: string;
    readonly result_match: boolean;
    readonly replay_result: KernelResult;
} | {
    readonly replay: "refused";
    readonly mode: "execute";
    readonly reason: "non_deterministic_task" | "non_deterministic_command" | "non_deterministic_inline_js";
    readonly task_index: number;
    readonly original_checksum: string;
    readonly new_checksum: null;
};
export type ClassifierResult = {
    readonly verdict: "replayable";
} | {
    readonly verdict: "non_replayable";
    readonly task_index: number;
    readonly reason?: "non_deterministic_task" | "non_deterministic_command" | "non_deterministic_inline_js";
};
//# sourceMappingURL=types.d.ts.map