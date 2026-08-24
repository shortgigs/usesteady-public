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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { dirname, join } from "node:path";
import { RESUME_TOKEN_FORMAT_V1, } from "./resume-token-types.js";
// ─── Path resolution ────────────────────────────────────────────────────────
/**
 * Canonical resume-tokens directory inside a workspace. Created lazily
 * by `writeResumeToken`; never created by readers.
 *
 * Note: this path is operator-visible and operator-deletable. There is
 * no shadow store anywhere else.
 */
export function resumeTokensDir(workspaceRoot) {
    return join(workspaceRoot, ".usesteady", "resume-tokens");
}
/**
 * Canonical filename for the token belonging to a given workflow run.
 * One file per `workflow_run_id` per workspace.
 */
export function resumeTokenPathFor(workspaceRoot, workflowRunId) {
    return join(resumeTokensDir(workspaceRoot), `${workflowRunId}.json`);
}
// ─── Computed fields ────────────────────────────────────────────────────────
/**
 * Compute the `token_id` field — the first 16 hex chars of a stable
 * SHA-256 over the token's content-bearing fields. Cosmetic (used for
 * operator-facing display + the optional `workflow tokens` list); the
 * load-bearing identity is `workflow_spec_hash` + `workspace_root`.
 */
export function computeTokenId(token) {
    // Canonical serialization for the hash input: sort top-level keys so
    // re-issued tokens with identical content produce the same id.
    const canonical = JSON.stringify(token, Object.keys(token).sort());
    return "sha256:" + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
// ─── Write ──────────────────────────────────────────────────────────────────
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
export function writeResumeToken(workspaceRoot, token) {
    const dir = resumeTokensDir(workspaceRoot);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const finalPath = resumeTokenPathFor(workspaceRoot, token.workflow_run_id);
    const tmpPath = `${finalPath}.tmp`;
    // Single line + trailing newline — same convention as JSON output of
    // workflow inspect. Avoids accidental diff churn from pretty-print
    // variants.
    const body = JSON.stringify(token) + "\n";
    // Best-effort cleanup of a stranded .tmp from a prior crash.
    if (existsSync(tmpPath)) {
        try {
            unlinkSync(tmpPath);
        }
        catch { /* non-fatal */ }
    }
    writeFileSync(tmpPath, body, "utf8");
    renameSync(tmpPath, finalPath);
}
function isStringArrayOfSummaries(value) {
    if (!Array.isArray(value))
        return false;
    return value.every((entry) => entry !== null
        && typeof entry === "object"
        && typeof entry["index"] === "number"
        && typeof entry["label"] === "string"
        && typeof entry["op_type"] === "string"
        && typeof entry["idempotency_class"] === "string");
}
/**
 * Parse + shape-check a token file. Returns a discriminated union;
 * callers handle each case explicitly.
 *
 * The function is "structural" — it does NOT validate the token
 * against a current spec or workspace. That's `validateTokenAgainstSpec`.
 */
export function readResumeToken(path) {
    if (!existsSync(path)) {
        return { kind: "missing", path, reason: `Resume token file not found at ${path}` };
    }
    let raw;
    try {
        raw = readFileSync(path, "utf8");
    }
    catch (err) {
        return {
            kind: "missing",
            path,
            reason: `Could not read resume token at ${path}: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        return {
            kind: "invalid",
            path,
            reason: `Resume token JSON is malformed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { kind: "invalid", path, reason: "Resume token must be a JSON object." };
    }
    const obj = parsed;
    if (typeof obj["format"] !== "string") {
        return { kind: "invalid", path, reason: "Resume token missing 'format' field." };
    }
    if (obj["format"] !== RESUME_TOKEN_FORMAT_V1) {
        return { kind: "unsupported_format", path, seen: String(obj["format"]) };
    }
    const required = [
        ["workflow_run_id", "string"],
        ["workflow_name", "string"],
        ["workflow_spec_hash", "string"],
        ["spec_path", "string"],
        ["workspace_root", "string"],
        ["completed_task_count", "number"],
        ["total_task_count", "number"],
        ["completed_task_summaries", "summaries"],
        ["issued_at", "string"],
        ["issued_by", "string"],
        ["token_id", "string"],
    ];
    for (const [key, expectedKind] of required) {
        const v = obj[key];
        if (expectedKind === "string" && typeof v !== "string") {
            return { kind: "invalid", path, reason: `Resume token field '${String(key)}' must be a string.` };
        }
        if (expectedKind === "number" && (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v))) {
            return { kind: "invalid", path, reason: `Resume token field '${String(key)}' must be an integer.` };
        }
        if (expectedKind === "summaries" && !isStringArrayOfSummaries(v)) {
            return { kind: "invalid", path, reason: `Resume token field 'completed_task_summaries' is malformed.` };
        }
    }
    const token = {
        format: RESUME_TOKEN_FORMAT_V1,
        workflow_run_id: obj["workflow_run_id"],
        workflow_name: obj["workflow_name"],
        workflow_spec_hash: obj["workflow_spec_hash"],
        spec_path: obj["spec_path"],
        workspace_root: obj["workspace_root"],
        completed_task_count: obj["completed_task_count"],
        total_task_count: obj["total_task_count"],
        completed_task_summaries: obj["completed_task_summaries"],
        issued_at: obj["issued_at"],
        issued_by: obj["issued_by"],
        token_id: obj["token_id"],
    };
    return { kind: "ok", token };
}
// ─── Tiny helper: ensure directory exists (used by tests / callers) ─────────
/**
 * Exposed so tests / external tooling can pre-create the directory
 * without writing a token. Production code goes through
 * `writeResumeToken` which calls this internally.
 */
export function ensureResumeTokensDir(workspaceRoot) {
    const d = resumeTokensDir(workspaceRoot);
    if (!existsSync(d))
        mkdirSync(d, { recursive: true });
}
// ─── Re-export the canonical filename helper for test convenience ───────────
export { dirname as nodePathDirname };
//# sourceMappingURL=resume-token-io.js.map