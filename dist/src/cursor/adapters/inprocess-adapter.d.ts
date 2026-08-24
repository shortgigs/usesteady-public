/**
 * Cursor In-Process Adapter — first real CursorEditorPlugin implementation.
 *
 * ── What this is ───────────────────────────────────────────────────────────────
 *
 *   This is the mechanism-agnostic contract made concrete.
 *   No IPC, no external process, no network — pure filesystem reads and writes.
 *
 *   It applies parsedChange (oldValue -> newValue in filePath) directly using
 *   Node.js fs. It is the simplest valid real adapter and proves the contract
 *   works outside of a stub.
 *
 * ── Three paths this adapter exercises ────────────────────────────────────────
 *
 *   Path A (accepted):
 *     - parsedChange is present
 *     - target file is readable and within allowedFiles (if non-empty)
 *     - oldValue appears exactly once in the file
 *     - file is rewritten with newValue and CursorAccepted is returned
 *
 *   Path B (refused_due_to_scope):
 *     - allowedFiles is empty AND parsedChange has no filePath
 *     - allowedFiles has multiple entries and oldValue appears in more than one
 *     - parsedChange is absent and no single target file can be determined
 *     Returns a structured CursorScopeQuestion for H to resolve.
 *
 *   Path C (refused_due_to_execution_error):
 *     - file_not_found: target file does not exist on disk
 *     - old_value_not_found: oldValue is not present in the file
 *     - ambiguous_match: oldValue appears more than once in the file
 *       (cannot guarantee a safe, targeted replacement)
 *     - parse_error: parsedChange is absent (no edit directive)
 *
 * ── What this adapter does NOT do ─────────────────────────────────────────────
 *
 *   - It does not re-derive intent. changeSpec is the sole edit directive.
 *   - It does not write outside allowedFiles (when non-empty).
 *   - It does not persist UCP envelopes (the gate owns all persistence).
 *   - It does not validate workspace constraints (already done by the gate).
 *   - It does not call back into the intake pipeline.
 *
 * ── Replacement strategy ──────────────────────────────────────────────────────
 *
 *   Uses exact string matching (indexOf), not regex.
 *   This is intentional: parsedChange.oldValue is a verbatim extracted string
 *   from interpretation output. Regex matching would introduce ambiguity.
 *
 *   If oldValue appears more than once, the adapter refuses (ambiguous_match)
 *   rather than replacing all occurrences silently. The caller must clarify.
 *
 * See: docs/cursor-delivery-contract.md — delivery paths
 *      docs/cursor-allowedfiles-policy.md — allowedFiles semantics
 *      src/cursor/adapters/stub-adapter.ts — the stub this replaces
 */
import type { CursorEditorPlugin } from "../delivery-gate.js";
import type { CursorDeliveryRequest, CursorResponse } from "../types.js";
import type { FsPlugin, FsChange } from "../../workflow/types.js";
export declare class CursorInProcessAdapter implements CursorEditorPlugin, FsPlugin {
    private readonly workspaceRoot;
    /**
     * @param workspaceRoot  Absolute path to the workspace root.
     *                       Relative paths in allowedFiles and parsedChange.filePath
     *                       are resolved against this root.
     */
    constructor(workspaceRoot: string);
    receive(request: CursorDeliveryRequest): Promise<CursorResponse>;
    /**
     * S2 / friction #36 — defense-in-depth containment re-check.
     *
     * The FeasibilityValidator is the PRIMARY enforcement (it refuses any
     * IR whose path-bearing fields escape `workspaceRoot` before preview /
     * approval / fs probe). This per-fs-op re-check is the SECONDARY net.
     *
     * Rationale: K4 already proved (K4-I3) that a single check site is
     * insufficient — `path.join(workspaceRoot, "../../etc")` normalizes
     * OUT, and any future surface that bypasses the validator (custom
     * adapter callers, internal API consumers, future JSON shapes) would
     * silently land here with an unbounded path. The same predicate that
     * the validator uses lives in `src/input/feasibility-validator.ts`
     * and is imported here to guarantee the two layers can never disagree.
     *
     * Returns:
     *   - `null` if the raw path is contained (caller proceeds with
     *     `isAbsolute(p) ? p : join(workspaceRoot, p)`)
     *   - a `{ kind: "failed", errorCode: "outside_workspace", detail }`
     *     object if the path escapes — caller returns it directly.
     */
    private containmentRefusal;
    /**
     * Cluster B Iteration 2 / usesteady-public#50 — defense-in-depth
     * filename safety re-check.
     *
     * The FeasibilityValidator is the primary enforcement (refuses any
     * IR whose path-bearing fields would materialize an unsafe filename
     * before preview / approval / fs probe). This per-fs-op re-check is
     * the secondary net for callers that bypass the validator (custom
     * adapter consumers, internal API). Mirrors `containmentRefusal`.
     *
     * Scoped (by call site) to operations that MATERIALIZE a new
     * on-disk filename — `write_file`, `create_dir`, `rename` (to). Does
     * not run on `delete_file`, `append_file`, `prepend_file`, or
     * `rename` (from) for the same reasons documented in the validator:
     * the caller should be able to operate on pre-existing names.
     */
    private filenameSafetyRefusal;
    /**
     * Cluster B Iteration 4 / usesteady-public#60, #67 -- defense-in-depth
     * protected-path re-check at the fs-op layer.
     *
     * The FeasibilityValidator is the primary enforcement. This per-fs-op
     * re-check is the secondary net for callers that bypass the validator
     * (custom adapter consumers, internal API). Mirrors
     * `filenameSafetyRefusal` and `containmentRefusal`.
     *
     * Applied to every path-bearing fs-op (create_dir, write_file,
     * append_file, prepend_file, rename {from, to}, delete_file). The
     * scope is wider than `filenameSafetyRefusal` because the friction
     * shape is symmetric: deleting `.git/HEAD` is exactly as harmful as
     * creating it.
     */
    private protectedPathRefusal;
    executeFsOp(op: FsChange): Promise<{
        readonly kind: "accepted" | "failed";
        readonly detail?: string;
        readonly stdout?: string;
        readonly stderr?: string;
        readonly exitCode?: number;
        readonly errorCode?: string;
    }>;
    /**
     * Search for oldValue in a list of candidate files.
     * Returns single_match, multiple_matches, or not_found.
     * Reads each file from disk; skips files that cannot be read.
     *
     * Cluster B: a file counts as containing `oldValue` only if the
     * original-form `includes` AND the canonical-form `includes` agree.
     * A file that "matches" only in one view is treated as not matching
     * (the conservative position). This prevents an attacker from using
     * canonicalization tricks to either hide a match the search would
     * otherwise find, or surface a fake match that exists only after
     * canonicalization stripping.
     */
    private searchForOldValue;
    private isSymlinkPath;
    private readUtf8TextStrict;
}
//# sourceMappingURL=inprocess-adapter.d.ts.map