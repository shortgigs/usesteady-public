/**
 * src/workflow/resume-token-io.ts
 *
 * P2-min — Resume Token I/O.
 *
 * Atomic write, atomic-rename, parse, and canonical path resolution
 * for v1 resume tokens. No state machine logic, no validation against
 * a spec — see `resume-token-validator.ts` for that.
 *
 * Authority discipline:
 *   - Writes live ONLY under `<workspace_root>/.usesteady/resume-tokens/`.
 *     No writes to `~/.config`, `~/.usesteady`, or `os.tmpdir()`.
 *   - Atomic-rename guarantees that a partial write never replaces a
 *     previously-valid token. The `.tmp` sibling is the only transient
 *     artifact.
 *   - Read parses + minimally type-checks the JSON shape. Full
 *     against-spec validation is a separate concern.
 */
import { dirname } from "node:path";
import { type ResumeTokenV1 } from "./resume-token-types.js";
/**
 * Canonical resume-tokens directory inside a workspace. Created lazily
 * by `writeResumeToken`; never created by readers.
 *
 * Note: this path is operator-visible and operator-deletable. There is
 * no shadow store anywhere else.
 */
export declare function resumeTokensDir(workspaceRoot: string): string;
/**
 * Canonical filename for the token belonging to a given workflow run.
 * One file per `workflow_run_id` per workspace.
 */
export declare function resumeTokenPathFor(workspaceRoot: string, workflowRunId: string): string;
/**
 * Compute the `token_id` field — the first 16 hex chars of a stable
 * SHA-256 over the token's content-bearing fields. Cosmetic (used for
 * operator-facing display + the optional `workflow tokens` list); the
 * load-bearing identity is `workflow_spec_hash` + `workspace_root`.
 */
export declare function computeTokenId(token: Omit<ResumeTokenV1, "token_id">): string;
/**
 * Atomic write of a resume token. On success the canonical path holds
 * exactly the JSON of `token`. On failure (rare; rename hit a
 * permissions or cross-device issue) the previous token, if any, is
 * untouched.
 *
 * Mechanics:
 *   1. Ensure `<workspace_root>/.usesteady/resume-tokens/` exists.
 *   2. Write to `<canonical>.tmp`.
 *   3. Rename `.tmp` over the canonical path.
 *
 * The rename is the atomic step on every supported OS (POSIX rename(),
 * Windows MoveFileEx with REPLACE_EXISTING). A crash between step 2
 * and step 3 leaves the previous canonical file intact and orphans the
 * `.tmp`; that's acceptable — the next successful write cleans it up.
 */
export declare function writeResumeToken(workspaceRoot: string, token: ResumeTokenV1): void;
/**
 * Result of attempting to read a token file. Shape-only validation:
 *
 *   - "ok"      → JSON parsed and structurally well-formed; ready for
 *                 spec/workspace-level validation.
 *   - "missing" → file does not exist or could not be opened.
 *   - "invalid" → JSON parse failed or required field missing/wrong-type.
 *   - "unsupported_format" → `format` field is present but not v1
 *                 (e.g. a future v2 token fed to this v1 reader).
 */
export type TokenReadResult = {
    readonly kind: "ok";
    readonly token: ResumeTokenV1;
} | {
    readonly kind: "missing";
    readonly path: string;
    readonly reason: string;
} | {
    readonly kind: "invalid";
    readonly path: string;
    readonly reason: string;
} | {
    readonly kind: "unsupported_format";
    readonly path: string;
    readonly seen: string;
};
/**
 * Parse + shape-check a token file. Returns a discriminated union;
 * callers handle each case explicitly.
 *
 * The function is "structural" — it does NOT validate the token
 * against a current spec or workspace. That's `validateTokenAgainstSpec`.
 */
export declare function readResumeToken(path: string): TokenReadResult;
/**
 * Exposed so tests / external tooling can pre-create the directory
 * without writing a token. Production code goes through
 * `writeResumeToken` which calls this internally.
 */
export declare function ensureResumeTokensDir(workspaceRoot: string): void;
export { dirname as nodePathDirname };
//# sourceMappingURL=resume-token-io.d.ts.map