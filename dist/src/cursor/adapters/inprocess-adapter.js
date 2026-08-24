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
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, lstatSync, } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, isAbsolute, dirname } from "node:path";
import { matchesGlob } from "../glob-matcher.js";
import { canonicalizeForSafety, CanonicalizationError } from "../../safety/canonicalize.js";
import { validateFilenameSafety, validateReplacementTextSafety, validateProtectedPath, classifyNormalizationDivergence, describeNormalizationDivergence, } from "../../safety/filename-safety.js";
import { pathEscapesWorkspace, OUTSIDE_WORKSPACE_MSG } from "../../input/feasibility-validator.js";
// ─── Cluster B helpers (canonicalization-aware comparison) ────────────────────
//
// These helpers exist so each adjacent safety surface in this adapter
// applies the same canonical-form rule consistently. They reuse Row 1's
// canonicalizeForSafety unchanged — no new Unicode policy is introduced
// here, and no second canonicalization function is added.
/**
 * Canonicalize a string for safety comparison. Returns null on
 * canonicalization failure (fail-closed: callers treat null as a
 * conservative refusal, matching Row 1's safety-gate contract).
 */
function safeCanonicalize(raw) {
    try {
        return canonicalizeForSafety(raw);
    }
    catch (err) {
        if (err instanceof CanonicalizationError)
            return null;
        return null;
    }
}
/**
 * Cluster B path equality — two file paths are equal for allowed-files
 * / prohibited-pattern purposes iff (a) their original strings match
 * AND (b) their canonical forms match. Both must agree. If either
 * canonicalization fails, returns false (fail-closed).
 *
 * This closes the bypass where an attacker provides a path that
 * compares-equal to an allowedFiles entry under raw-string equality
 * but resolves to a different file at the OS layer because of hidden
 * codepoints — or, symmetrically, a path that does NOT compare-equal
 * to an entry but visually does (via NFC/NFD or zero-width
 * obfuscation).
 */
function pathsEqualByCanonical(a, b) {
    if (a === b) {
        const canonA = safeCanonicalize(a);
        const canonB = safeCanonicalize(b);
        if (canonA === null || canonB === null)
            return false;
        return canonA === canonB;
    }
    const canonA = safeCanonicalize(a);
    const canonB = safeCanonicalize(b);
    if (canonA === null || canonB === null)
        return false;
    return canonA === canonB;
}
/**
 * Cluster B glob match — true iff the path matches a glob under both
 * the original-string view AND the canonical-string view. If
 * canonicalization fails, returns false (fail-closed, matches the
 * surrounding "is this prohibited" predicate semantics: when in
 * doubt, treat as prohibited).
 */
function matchesGlobOnBothViews(path, pattern) {
    if (matchesGlob(path, pattern))
        return true;
    const canonical = safeCanonicalize(path);
    if (canonical === null)
        return false;
    if (canonical === path)
        return false;
    return matchesGlob(canonical, pattern);
}
// ─── Adapter ──────────────────────────────────────────────────────────────────
export class CursorInProcessAdapter {
    workspaceRoot;
    /**
     * @param workspaceRoot  Absolute path to the workspace root.
     *                       Relative paths in allowedFiles and parsedChange.filePath
     *                       are resolved against this root.
     */
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async receive(request) {
        const { deliveryId, artifact } = request;
        const { changeSpec, scopeConstraint } = artifact;
        const parsedChange = changeSpec.parsedChange;
        // ── Step 1: Resolve target file ──────────────────────────────────────────
        // If no parsedChange, we have no edit directive — cannot proceed.
        if (!parsedChange) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "parse_error",
                detail: "No parsedChange present in changeSpec. Cannot determine an edit directive.",
            };
        }
        // Determine the target file:
        //   1. parsedChange.filePath (authoritative — proposed by artifact mapper)
        //   2. single allowedFiles entry (unambiguous — H narrowed to one file)
        //   3. search all allowedFiles for oldValue (scope clarification if > 1 match)
        //   4. if allowedFiles is empty, we have no search space → scope question
        let targetFile;
        if (parsedChange.filePath) {
            targetFile = parsedChange.filePath;
        }
        else if (scopeConstraint.allowedFiles.length === 1) {
            targetFile = scopeConstraint.allowedFiles[0];
        }
        else if (scopeConstraint.allowedFiles.length > 1) {
            // Search all allowedFiles for oldValue — clarify if > 1 match
            const result = this.searchForOldValue(parsedChange.oldValue, scopeConstraint.allowedFiles);
            if (result.kind === "not_found") {
                return {
                    kind: "refused_due_to_execution_error",
                    deliveryId,
                    artifactId: artifact.id,
                    receivedAt: Date.now(),
                    errorCode: "old_value_not_found",
                    detail: `"${parsedChange.oldValue}" was not found in any of the allowed files: ${scopeConstraint.allowedFiles.join(", ")}`,
                };
            }
            if (result.kind === "multiple_matches") {
                return {
                    kind: "refused_due_to_scope",
                    deliveryId,
                    artifactId: artifact.id,
                    receivedAt: Date.now(),
                    scopeQuestion: {
                        questionKind: "need_file_path",
                        candidates: result.files,
                        searchedFor: parsedChange.oldValue,
                        explanation: `Found "${parsedChange.oldValue}" in ${result.files.length} files. Select the target.`,
                    },
                };
            }
            // result.kind === "single_match" — TypeScript narrowed above via early returns
            targetFile = result.file;
        }
        else {
            // allowedFiles is empty and parsedChange has no filePath — open search
            return {
                kind: "refused_due_to_scope",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                scopeQuestion: {
                    questionKind: "need_file_path",
                    candidates: [],
                    searchedFor: parsedChange.oldValue,
                    explanation: "No file path specified and allowedFiles is empty. Provide a target file path.",
                },
            };
        }
        // TypeScript cannot prove targetFile is defined through the branching above,
        // but all code paths either return early or assign it. Assert non-null here.
        const resolvedFile = targetFile;
        // ── Step 2: Scope boundary enforcement ───────────────────────────────────
        // Cluster B — allowedFiles.includes is a string-equality check. An
        // attacker could craft `resolvedFile` to compare-equal to an entry
        // under raw string equality but differ at the canonical level
        // (NFC/NFD, zero-width, BIDI), or vice versa. pathsEqualByCanonical
        // requires both the original AND the canonical forms to match.
        if (scopeConstraint.allowedFiles.length > 0) {
            const allowed = scopeConstraint.allowedFiles.some((entry) => pathsEqualByCanonical(entry, resolvedFile));
            if (!allowed) {
                return {
                    kind: "refused_due_to_execution_error",
                    deliveryId,
                    artifactId: artifact.id,
                    receivedAt: Date.now(),
                    errorCode: "scope_outside_allowed",
                    detail: `Target file "${resolvedFile}" is not in allowedFiles.`,
                };
            }
        }
        // Cluster B — prohibitedPattern matching now runs on both the
        // original-form path AND the canonical form. A path that uses
        // zero-width / BIDI obfuscation to dodge the glob will be caught
        // because matchesGlobOnBothViews additionally tests the canonical
        // form against the same pattern.
        const normalized = resolvedFile.replace(/\\/g, "/");
        for (const pattern of scopeConstraint.prohibitedPatterns) {
            if (matchesGlobOnBothViews(normalized, pattern)) {
                return {
                    kind: "refused_due_to_execution_error",
                    deliveryId,
                    artifactId: artifact.id,
                    receivedAt: Date.now(),
                    errorCode: "prohibited_pattern_match",
                    detail: `Target file "${resolvedFile}" matches prohibited pattern "${pattern}".`,
                };
            }
        }
        // ── Step 2.5: Workspace containment (S2 / friction #36) ──────────────────
        //
        // Defense-in-depth re-check. The FeasibilityValidator catches absolute /
        // drive / UNC / ..-after-normalize paths at the validate stage for the
        // JSON / batch IR surfaces. This re-check guarantees the executor still
        // refuses if any future caller bypasses the validator (custom adapter
        // consumers, internal API). Mirrors the per-fs-op check in `executeFsOp`.
        //
        // Note: the existing `scope_outside_allowed` check above only fires when
        // `allowedFiles` is non-empty (cursor sessions). Workspace containment
        // is a stronger boundary that holds even when `allowedFiles` is empty.
        if (pathEscapesWorkspace(resolvedFile)) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "outside_workspace",
                detail: `${OUTSIDE_WORKSPACE_MSG} (file: ${resolvedFile})`,
            };
        }
        // ── Step 3: Resolve absolute path ────────────────────────────────────────
        const absolutePath = isAbsolute(resolvedFile)
            ? resolvedFile
            : join(this.workspaceRoot, resolvedFile);
        if (this.isSymlinkPath(absolutePath)) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "merge_conflict",
                detail: `Refusing to edit symlink target: ${absolutePath}`,
            };
        }
        // ── Step 4: Read and apply the change ─────────────────────────────────────
        if (!existsSync(absolutePath)) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "file_not_found",
                detail: `File not found: ${absolutePath}`,
            };
        }
        const contentRead = this.readUtf8TextStrict(absolutePath);
        if (!contentRead.ok) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: contentRead.error === "missing" ? "file_not_found" : "merge_conflict",
                detail: contentRead.detail,
            };
        }
        const content = contentRead.text;
        const { oldValue, newValue } = parsedChange;
        // ── Cluster B Iter 2 / public#52 — replacement-text safety gate ─────────
        //
        // Iteration 1's canonicalization gate validated `oldValue` against
        // file content but wrote `newValue` verbatim. A `to: "Se\u202End"`
        // landed on disk unsanitized. This gate refuses the replace when
        // `newValue` contains BIDI, zero-width, or control codepoints —
        // characters whose written bytes would not match what was
        // previewed. Newlines and tabs are explicitly allowed (multi-line
        // edits are a normal use case); see
        // `validateReplacementTextSafety` for the precise class set.
        const replacementSafety = validateReplacementTextSafety(newValue);
        if (!replacementSafety.ok) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "invalid_replacement_chars",
                detail: `Refusing to apply replacement to "${resolvedFile}": ${replacementSafety.detail}`,
            };
        }
        // ── Cluster B — replace-match canonicalization gate ──────────────────────
        //
        // The original `indexOf` / `lastIndexOf` matching is preserved
        // verbatim below for the actual replacement (so the file's bytes
        // are not silently rewritten in NFKC form). Cluster B adds a
        // *gate* on top: the canonical-form occurrence count must agree
        // with the original-form occurrence count. If they disagree, the
        // operation is refused as `ambiguous_match`, because either:
        //
        //   (a) the file content contains hidden codepoints that
        //       canonicalize *into* a match the original-form scan does
        //       not see (an attacker hid an oldValue match using
        //       zero-width / BIDI), or
        //   (b) the oldValue contains hidden codepoints that
        //       canonicalize *out of* the match the file actually has
        //       (an attacker disguised an oldValue to be visually
        //       harmless but bypass denylists).
        //
        // Either case is a canonical-view divergence; refusing matches
        // the Cluster B invariant that adjacent surfaces (file content,
        // user-supplied oldValue, safety detector) all see the same
        // canonical interpretation.
        const canonOldValue = safeCanonicalize(oldValue);
        const canonContent = safeCanonicalize(content);
        if (canonOldValue === null || canonContent === null) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "ambiguous_match",
                detail: `Canonicalization failed for "${resolvedFile}" or its replacement target. Refusing to apply the change.`,
            };
        }
        const originalOccurrences = countOccurrences(content, oldValue);
        const canonicalOccurrences = countOccurrences(canonContent, canonOldValue);
        if (originalOccurrences !== canonicalOccurrences) {
            // Cluster B Iter 2 / public#51 — upgrade the diagnostic.
            // Classify *why* the canonical and original views disagree so
            // the user sees an actionable cause (Unicode normalization
            // mismatch, hidden codepoints in their search string, hidden
            // codepoints in the file content) instead of the opaque
            // "match-count mismatch" string. The disposition is unchanged
            // — still refused — but the detail now names the cause.
            const cause = classifyNormalizationDivergence(oldValue, content);
            const detail = describeNormalizationDivergence(cause, oldValue, resolvedFile) +
                ` (diagnostic: original-form occurrences=${originalOccurrences}, ` +
                `canonical-form occurrences=${canonicalOccurrences})`;
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "ambiguous_match",
                detail,
            };
        }
        const firstIndex = content.indexOf(oldValue);
        if (firstIndex === -1) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "old_value_not_found",
                detail: `"${oldValue}" was not found in "${resolvedFile}".`,
            };
        }
        const lastIndex = content.lastIndexOf(oldValue);
        if (lastIndex !== firstIndex) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "ambiguous_match",
                detail: `"${oldValue}" appears more than once in "${resolvedFile}". Cannot safely apply a targeted replacement.`,
            };
        }
        // Apply the replacement — exact, single occurrence.
        const updated = content.slice(0, firstIndex) + newValue + content.slice(firstIndex + oldValue.length);
        try {
            writeFileSync(absolutePath, updated, "utf8");
        }
        catch (err) {
            return {
                kind: "refused_due_to_execution_error",
                deliveryId,
                artifactId: artifact.id,
                receivedAt: Date.now(),
                errorCode: "merge_conflict",
                detail: `Failed to write file "${absolutePath}": ${String(err)}`,
            };
        }
        // ── Step 5: Return accepted ───────────────────────────────────────────────
        return {
            kind: "accepted",
            deliveryId,
            artifactId: artifact.id,
            receivedAt: Date.now(),
        };
    }
    // ── FsPlugin: filesystem primitives ─────────────────────────────────────────
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
    containmentRefusal(rawPath, fieldName) {
        if (!pathEscapesWorkspace(rawPath))
            return null;
        return {
            kind: "failed",
            errorCode: "outside_workspace",
            detail: `${OUTSIDE_WORKSPACE_MSG} (${fieldName}: ${rawPath})`,
        };
    }
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
    filenameSafetyRefusal(rawPath, fieldName) {
        // Cluster B Iter 2 + Iter 3: map the validator's internal
        // discriminant to the public `CliErrorCode` surface.
        //
        //   `invalid_filename_reserved_name`      → propagated (Iter 3's
        //                                            one new public code)
        //   `invalid_filename_canonical_divergence`,
        //   `canonicalization_failed`             → umbrella'd under
        //                                            `invalid_filename_chars`
        //                                            (already-public Iter 2 code).
        //
        // Hardcoding `invalid_filename_chars` for *all* cases (the original
        // Iter 2 implementation) silently masked Iter 3's reserved-name
        // refusal — the bug this fix closed.
        const result = validateFilenameSafety(rawPath);
        if (result.ok)
            return null;
        const errorCode = result.code === "invalid_filename_reserved_name"
            ? "invalid_filename_reserved_name"
            : "invalid_filename_chars";
        return {
            kind: "failed",
            errorCode,
            detail: `Refusing to create unsafe filename (${fieldName}: ${rawPath}). ${result.detail}`,
        };
    }
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
    protectedPathRefusal(rawPath, fieldName) {
        const result = validateProtectedPath(rawPath);
        if (result.ok)
            return null;
        return {
            kind: "failed",
            errorCode: "prohibited_path",
            detail: `Refusing operation on protected path (${fieldName}: ${rawPath}). ${result.detail}`,
        };
    }
    async executeFsOp(op) {
        try {
            switch (op.operationType) {
                case "create_dir": {
                    const refused = this.containmentRefusal(op.dirPath, "path");
                    if (refused !== null)
                        return refused;
                    const filenameRefused = this.filenameSafetyRefusal(op.dirPath, "path");
                    if (filenameRefused !== null)
                        return filenameRefused;
                    const protectedRefused = this.protectedPathRefusal(op.dirPath, "path");
                    if (protectedRefused !== null)
                        return protectedRefused;
                    const abs = isAbsolute(op.dirPath) ? op.dirPath : join(this.workspaceRoot, op.dirPath);
                    // Issue #49 — defense-in-depth for create_dir target-exists.
                    // The feasibility validator catches this case pre-receive; this
                    // adapter check is the analogous mirror of `case "write_file"`'s
                    // existsSync refusal (which has been in place for the file path
                    // since M3). Without this guard, a race between validate and
                    // execute could let an externally-created directory slip through
                    // and silently no-op under `mkdirSync(..., { recursive: true })`.
                    if (existsSync(abs)) {
                        return {
                            kind: "failed",
                            errorCode: "target_exists",
                            detail: `Refusing to create directory: target already exists at ${abs}`,
                        };
                    }
                    mkdirSync(abs, { recursive: true });
                    return { kind: "accepted" };
                }
                case "write_file": {
                    const refused = this.containmentRefusal(op.filePath, "file");
                    if (refused !== null)
                        return refused;
                    const filenameRefused = this.filenameSafetyRefusal(op.filePath, "file");
                    if (filenameRefused !== null)
                        return filenameRefused;
                    const protectedRefused = this.protectedPathRefusal(op.filePath, "file");
                    if (protectedRefused !== null)
                        return protectedRefused;
                    const abs = isAbsolute(op.filePath) ? op.filePath : join(this.workspaceRoot, op.filePath);
                    if (this.isSymlinkPath(abs)) {
                        return {
                            kind: "failed",
                            errorCode: "merge_conflict",
                            detail: `Refusing to write via symlink path: ${abs}`,
                        };
                    }
                    if (existsSync(abs)) {
                        return {
                            kind: "failed",
                            errorCode: "target_exists",
                            detail: `Refusing to overwrite existing file: ${abs}`,
                        };
                    }
                    mkdirSync(dirname(abs), { recursive: true });
                    writeFileSync(abs, op.content, "utf8");
                    return { kind: "accepted" };
                }
                case "append_file": {
                    const refused = this.containmentRefusal(op.filePath, "file");
                    if (refused !== null)
                        return refused;
                    const protectedRefused = this.protectedPathRefusal(op.filePath, "file");
                    if (protectedRefused !== null)
                        return protectedRefused;
                    const abs = isAbsolute(op.filePath) ? op.filePath : join(this.workspaceRoot, op.filePath);
                    if (this.isSymlinkPath(abs)) {
                        return { kind: "failed", detail: `Refusing to append via symlink path: ${abs}` };
                    }
                    let current = "";
                    if (existsSync(abs)) {
                        const read = this.readUtf8TextStrict(abs);
                        if (!read.ok)
                            return { kind: "failed", detail: read.detail };
                        current = read.text;
                    }
                    mkdirSync(dirname(abs), { recursive: true });
                    writeFileSync(abs, current + op.content, "utf8");
                    return { kind: "accepted" };
                }
                case "prepend_file": {
                    const refused = this.containmentRefusal(op.filePath, "file");
                    if (refused !== null)
                        return refused;
                    const protectedRefused = this.protectedPathRefusal(op.filePath, "file");
                    if (protectedRefused !== null)
                        return protectedRefused;
                    const abs = isAbsolute(op.filePath) ? op.filePath : join(this.workspaceRoot, op.filePath);
                    if (this.isSymlinkPath(abs)) {
                        return { kind: "failed", detail: `Refusing to prepend via symlink path: ${abs}` };
                    }
                    let current = "";
                    if (existsSync(abs)) {
                        const read = this.readUtf8TextStrict(abs);
                        if (!read.ok)
                            return { kind: "failed", detail: read.detail };
                        current = read.text;
                    }
                    mkdirSync(dirname(abs), { recursive: true });
                    writeFileSync(abs, op.content + current, "utf8");
                    return { kind: "accepted" };
                }
                case "rename": {
                    const refusedFrom = this.containmentRefusal(op.filePath, "from");
                    if (refusedFrom !== null)
                        return refusedFrom;
                    const refusedTo = this.containmentRefusal(op.newPath, "to");
                    if (refusedTo !== null)
                        return refusedTo;
                    // Filename safety applies only to the rename DESTINATION.
                    // The source must already exist on disk, so its name is
                    // pre-existing and may legitimately need to be renamed.
                    const filenameRefusedTo = this.filenameSafetyRefusal(op.newPath, "to");
                    if (filenameRefusedTo !== null)
                        return filenameRefusedTo;
                    // Cluster B Iter 4: protected-path applies SYMMETRICALLY --
                    // renaming a workspace file INTO `.git/HEAD` corrupts git,
                    // and renaming `.git/HEAD` OUT of `.git/` also corrupts git
                    // (the source object becomes orphaned).
                    const protectedRefusedFrom = this.protectedPathRefusal(op.filePath, "from");
                    if (protectedRefusedFrom !== null)
                        return protectedRefusedFrom;
                    const protectedRefusedTo = this.protectedPathRefusal(op.newPath, "to");
                    if (protectedRefusedTo !== null)
                        return protectedRefusedTo;
                    const absOld = isAbsolute(op.filePath) ? op.filePath : join(this.workspaceRoot, op.filePath);
                    const absNew = isAbsolute(op.newPath) ? op.newPath : join(this.workspaceRoot, op.newPath);
                    if (this.isSymlinkPath(absOld) || this.isSymlinkPath(absNew)) {
                        return {
                            kind: "failed",
                            errorCode: "merge_conflict",
                            detail: `Refusing to rename symlink path: ${absOld} -> ${absNew}`,
                        };
                    }
                    // Node's renameSync silently overwrites the destination on POSIX
                    // and on Windows when the target is a file — same destructive
                    // surprise either way. Guard explicitly so rename is never a
                    // silent data-loss op. Callers must delete+rename if replacement
                    // is intended.
                    if (existsSync(absNew)) {
                        return {
                            kind: "failed",
                            errorCode: "target_exists",
                            detail: `Refusing to rename over existing destination: ${absNew}`,
                        };
                    }
                    renameSync(absOld, absNew);
                    return { kind: "accepted" };
                }
                case "delete_file": {
                    const refused = this.containmentRefusal(op.filePath, "file");
                    if (refused !== null)
                        return refused;
                    // Cluster B Iter 4 / public#67 -- defense-in-depth refusal of
                    // `delete .git/HEAD` (and other git internals). Unlike the
                    // filename-safety check (which skips delete so users can clean
                    // up files with bad codepoints), protected-path check DOES run
                    // on delete because the friction shape is symmetric.
                    const protectedRefused = this.protectedPathRefusal(op.filePath, "file");
                    if (protectedRefused !== null)
                        return protectedRefused;
                    const abs = isAbsolute(op.filePath) ? op.filePath : join(this.workspaceRoot, op.filePath);
                    if (this.isSymlinkPath(abs)) {
                        return { kind: "failed", detail: `Refusing to delete symlink path: ${abs}` };
                    }
                    // M3 defense-in-depth: the FeasibilityValidator catches delete-
                    // missing at the validate stage and surfaces file_not_found per
                    // the §6.5.2 deliberate refinement. This existsSync check closes
                    // the TOCTOU window between validate and execute so a file that
                    // vanishes after validation still surfaces file_not_found
                    // (matching the validate-stage behavior) rather than falling
                    // through to the outer catch as execution_error.
                    if (!existsSync(abs)) {
                        return {
                            kind: "failed",
                            errorCode: "file_not_found",
                            detail: `File not found: ${abs}`,
                        };
                    }
                    unlinkSync(abs);
                    return { kind: "accepted" };
                }
                case "run_command": {
                    const exec = spawnSync(op.command, {
                        cwd: this.workspaceRoot,
                        shell: true,
                        encoding: "utf8",
                        windowsHide: true,
                    });
                    const stdout = exec.stdout ?? "";
                    const stderr = exec.stderr ?? "";
                    const exitCode = typeof exec.status === "number" ? exec.status : 1;
                    if (exitCode !== 0) {
                        return {
                            kind: "failed",
                            detail: `Command failed with exit code ${exitCode}`,
                            stdout,
                            stderr,
                            exitCode,
                        };
                    }
                    return { kind: "accepted", stdout, stderr, exitCode };
                }
            }
        }
        catch (err) {
            return { kind: "failed", detail: String(err) };
        }
    }
    // ── Internal helpers ────────────────────────────────────────────────────────
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
    searchForOldValue(oldValue, allowedFiles) {
        const matches = [];
        const canonOldValue = safeCanonicalize(oldValue);
        for (const file of allowedFiles) {
            const absPath = isAbsolute(file) ? file : join(this.workspaceRoot, file);
            if (!existsSync(absPath))
                continue;
            let content;
            try {
                content = readFileSync(absPath, "utf8");
            }
            catch {
                continue;
            }
            const originalHas = content.includes(oldValue);
            // Canonical-form view: only consult when the original would
            // succeed (cheaper) and only count as a match if both agree.
            // If oldValue cannot be canonicalized we fall back to the
            // conservative answer (no match), matching the receive() path
            // which refuses on canonicalization failure.
            if (!originalHas)
                continue;
            if (canonOldValue === null)
                continue;
            const canonContent = safeCanonicalize(content);
            if (canonContent === null)
                continue;
            if (!canonContent.includes(canonOldValue))
                continue;
            matches.push(file);
        }
        if (matches.length === 0)
            return { kind: "not_found" };
        if (matches.length === 1)
            return { kind: "single_match", file: matches[0] };
        return { kind: "multiple_matches", files: matches };
    }
    isSymlinkPath(path) {
        try {
            return lstatSync(path).isSymbolicLink();
        }
        catch {
            return false;
        }
    }
    readUtf8TextStrict(path) {
        if (!existsSync(path)) {
            return { ok: false, error: "missing", detail: `File not found: ${path}` };
        }
        let raw;
        try {
            raw = readFileSync(path);
        }
        catch (err) {
            return { ok: false, error: "read_failed", detail: `Failed to read file "${path}": ${String(err)}` };
        }
        if (raw.includes(0)) {
            return { ok: false, error: "binary", detail: `Refusing to edit binary file: ${path}` };
        }
        try {
            return { ok: true, text: raw.toString("utf8") };
        }
        catch (err) {
            return { ok: false, error: "read_failed", detail: `Failed to decode UTF-8 file "${path}": ${String(err)}` };
        }
    }
}
// ─── Internal helpers ─────────────────────────────────────────────────────────
/**
 * Count non-overlapping occurrences of `needle` in `haystack`. Used by
 * the Cluster B replace-match gate to compare original-form vs
 * canonical-form occurrence counts. An empty needle returns 0 to
 * avoid the infinite-loop semantics of indexOf with a zero-length
 * pattern.
 */
function countOccurrences(haystack, needle) {
    if (needle.length === 0)
        return 0;
    let count = 0;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return count;
        count += 1;
        from = idx + needle.length;
    }
}
//# sourceMappingURL=inprocess-adapter.js.map