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
export {};
//# sourceMappingURL=types.js.map