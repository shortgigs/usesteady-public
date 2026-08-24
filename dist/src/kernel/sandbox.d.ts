/**
 * Kernel v1 / K4 — replay sandbox.
 *
 * ── Scope (PR-K4 design lock §3 D3, §10) ─────────────────────────────────────
 *
 *   K4-I3 (the P0 invariant): replay never touches the real workspace.
 *   The sandbox primitive is the enforcement mechanism.
 *
 *   - One mkdtempSync() call per replay invocation.
 *   - Sandbox path lives under os.tmpdir() — never under {storeDir}/, never
 *     under the workspace, never under the artifact's directory.
 *   - Sandbox is removed via rmSync(..., { recursive: true, force: true })
 *     in a `finally` block by the caller. Removal is best-effort — failure
 *     to delete is logged to stderr but does NOT change the verdict.
 *   - Prefix is "usesteady-replay-" so any leaked dirs are greppable.
 *   - --keep-sandbox is OUT OF SCOPE for K4 (deferred to a future PR).
 */
export declare const SANDBOX_PREFIX = "usesteady-replay-";
/**
 * Create a fresh sandbox directory under `os.tmpdir()`.
 *
 * Returns an absolute path. Throws on I/O failure (caller routes to exit 2).
 */
export declare function createSandbox(): {
    readonly path: string;
};
/**
 * Remove a sandbox directory. Idempotent; never throws.
 *
 * Cleanup failure is logged to stderr but does NOT change the verdict —
 * a leaked temp directory is strictly preferable to a misleading
 * "mismatch" / "match" caused by cleanup behavior.
 */
export declare function cleanupSandbox(path: string): void;
//# sourceMappingURL=sandbox.d.ts.map