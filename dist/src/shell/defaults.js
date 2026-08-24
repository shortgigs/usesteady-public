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
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
// ─── Cursor defaults ──────────────────────────────────────────────────────────
/**
 * Default Cursor OCD policy for CLI use.
 *
 * Protects: migrations, .env files, secrets, lockfiles, node_modules, .git.
 * Safe write zone: src/**, tests/**, docs/**.
 * Max files: 5 (reasonable for a single-command edit).
 * Workspace root: current working directory at startup.
 */
export const DEFAULT_CURSOR_POLICY = {
    writeSafeGlobs: ["src/**", "tests/**", "docs/**"],
    maxFilesApprovalThreshold: 5,
    alwaysProhibitedGlobs: [
        "**/migrations/**",
        "**/.env*",
        "**/secrets/**",
        "*.lock",
        "**/__generated__/**",
    ],
    emptyAllowedFilesAdditionalProhibitions: ["**/node_modules/**", "**/.git/**"],
    workspaceRoot: process.cwd(),
};
// ─── Claude defaults ──────────────────────────────────────────────────────────
/**
 * Default Claude OCD policy for CLI use.
 *
 * Same prohibited globs as the Cursor default.
 * writeSafeGlobs matches the Cursor policy for consistency.
 */
export const DEFAULT_CLAUDE_OCD_POLICY = {
    alwaysProhibitedGlobs: [
        "**/migrations/**",
        "**/.env*",
        "**/secrets/**",
        "*.lock",
        "**/__generated__/**",
    ],
    writeSafeGlobs: ["src/**", "tests/**", "docs/**"],
};
/**
 * Default Claude tool policy for CLI use.
 *
 * V1: network access is always "deny". filesystemMode is always "scoped_only".
 * Tools: the standard V1 read/write set.
 */
export const DEFAULT_CLAUDE_TOOL_POLICY = {
    allowedTools: ["str_replace_editor", "read_file", "list_files"],
    networkAccess: "deny",
    filesystemMode: "scoped_only",
};
// ─── UCP store ────────────────────────────────────────────────────────────────
/**
 * Default UCP store directory for the CLI shell.
 *
 * Uses the OS temp directory so demo runs do not pollute the workspace.
 * Production shells should point to a committed or managed store path.
 */
export const DEFAULT_STORE_DIR = join(tmpdir(), "usesteady-ucp");
/**
 * Resolve the UCP store directory for CLI read/write surfaces.
 *
 * Honors `USESTEADY_STORE_DIR` when set and non-empty; otherwise
 * `DEFAULT_STORE_DIR`. Single source of truth for run, history, timeline,
 * doctor, and JSON/batch shadow-envelope persistence.
 */
export function resolveStoreDir(env = process.env) {
    const override = env["USESTEADY_STORE_DIR"]?.trim();
    return override && override.length > 0 ? override : DEFAULT_STORE_DIR;
}
export function validateMappedStoreDir(candidateStoreDir, seam = {}) {
    if (candidateStoreDir.trim().length === 0) {
        return { ok: false, code: "mapped_store_configuration_required" };
    }
    const realpath = seam.realpath ?? realpathSync.native;
    let candidate;
    let tempRoot;
    try {
        candidate = realpath(candidateStoreDir);
        tempRoot = realpath(seam.tempRoot ?? tmpdir());
    }
    catch {
        return { ok: false, code: "mapped_store_unavailable" };
    }
    const platform = seam.platform ?? process.platform;
    const separator = seam.pathSeparator ?? sep;
    const fold = (value) => platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
    const canonicalCandidate = fold(candidate);
    const canonicalTemp = fold(tempRoot);
    const canonicalDefault = fold(join(tempRoot, "usesteady-ucp"));
    const temporary = canonicalCandidate === canonicalTemp ||
        canonicalCandidate.startsWith(`${canonicalTemp}${separator}`) ||
        canonicalCandidate === canonicalDefault;
    return temporary
        ? { ok: false, code: "mapped_store_configuration_required" }
        : { ok: true, canonicalStoreDir: candidate };
}
//# sourceMappingURL=defaults.js.map