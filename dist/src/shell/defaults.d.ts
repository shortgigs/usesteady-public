/**
 * Phase 9A: Shell default policies.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Sensible default policies for the CLI demo and development use.
 *   These are NOT authoritative policy for production deployments — each
 *   workspace should configure its own OCD policy.
 *
 *   They are exported here so the CLI main loop and integration tests can
 *   share a consistent baseline without duplicating policy literals.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────────
 *
 *   Production policy config (belongs in the workspace configuration layer).
 *   The UCP store path (depends on runtime environment — tmpdir for demo).
 */
import type { CursorOCDPolicy } from "../cursor/types.js";
import type { ClaudeOCDPolicy } from "../claude/artifact-mapper.js";
import type { ClaudeToolPolicy } from "../claude/types.js";
/**
 * Default Cursor OCD policy for CLI use.
 *
 * Protects: migrations, .env files, secrets, lockfiles, node_modules, .git.
 * Safe write zone: src/**, tests/**, docs/**.
 * Max files: 5 (reasonable for a single-command edit).
 * Workspace root: current working directory at startup.
 */
export declare const DEFAULT_CURSOR_POLICY: CursorOCDPolicy;
/**
 * Default Claude OCD policy for CLI use.
 *
 * Same prohibited globs as the Cursor default.
 * writeSafeGlobs matches the Cursor policy for consistency.
 */
export declare const DEFAULT_CLAUDE_OCD_POLICY: ClaudeOCDPolicy;
/**
 * Default Claude tool policy for CLI use.
 *
 * V1: network access is always "deny". filesystemMode is always "scoped_only".
 * Tools: the standard V1 read/write set.
 */
export declare const DEFAULT_CLAUDE_TOOL_POLICY: ClaudeToolPolicy;
/**
 * Default UCP store directory for the CLI shell.
 *
 * Uses the OS temp directory so demo runs do not pollute the workspace.
 * Production shells should point to a committed or managed store path.
 */
export declare const DEFAULT_STORE_DIR: string;
/**
 * Resolve the UCP store directory for CLI read/write surfaces.
 *
 * Honors `USESTEADY_STORE_DIR` when set and non-empty; otherwise
 * `DEFAULT_STORE_DIR`. Single source of truth for run, history, timeline,
 * doctor, and JSON/batch shadow-envelope persistence.
 */
export declare function resolveStoreDir(env?: Readonly<Record<string, string | undefined>>): string;
export type MappedStorePolicyResult = {
    readonly ok: true;
    readonly canonicalStoreDir: string;
} | {
    readonly ok: false;
    readonly code: "mapped_store_configuration_required" | "mapped_store_unavailable";
};
export type MappedStorePolicy = (candidateStoreDir: string) => MappedStorePolicyResult;
export declare function validateMappedStoreDir(candidateStoreDir: string, seam?: {
    readonly realpath?: (path: string) => string;
    readonly tempRoot?: string;
    readonly platform?: NodeJS.Platform;
    readonly pathSeparator?: string;
}): MappedStorePolicyResult;
//# sourceMappingURL=defaults.d.ts.map