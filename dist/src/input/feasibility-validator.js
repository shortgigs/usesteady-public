/**
 * src/input/feasibility-validator.ts
 *
 * M3 — `FeasibilityValidator`. The first runtime consumer of the IR.
 *
 * Per design §3.3 + §6.5 (`docs/CLI_INPUT_NORMALIZATION_DESIGN.md` v2.2),
 * the validator is a single pre-flight pass that runs path-level checks
 * against the current filesystem state before execution. It hoists a
 * subset of checks out of the executor without removing the executor's
 * defense-in-depth guards.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  M3 scope (load-bearing — see design §6.5)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * What this validator owns (path-level, NO file-content reads):
 *
 *   - `create` (`write_file`) target already exists       → `target_exists`
 *   - `rename` destination already exists                 → `target_exists`
 *   - `delete` target missing                             → `file_not_found`
 *     (deliberate public-surface refinement per §6.5.2 — was `execution_error`)
 *   - Symlink path-level refusal on `write_file`/`rename` → `merge_conflict`
 *     (additive only — same code surfaced earlier; executor guard stays)
 *
 * What stays at execute time (content-dependent or race-window):
 *
 *   - `replace` target file missing      → `file_not_found`      (executor reads file anyway)
 *   - `replace` `from` not present       → `old_value_not_found` (content-dependent)
 *   - `replace` `from` matches multiple  → `ambiguous_match`     (content-dependent)
 *   - Binary file (NUL byte) detection   → `merge_conflict`      (requires reading bytes)
 *   - `run_command` exit code, stdout/stderr (intrinsically execute-time)
 *
 * Post-M3 widening (usesteady-public#45 — occurrence-directive truthfulness):
 *
 *   - `replace` with explicit non-"first" `requestedOccurrence`
 *                                        → `ambiguous_match`     (validate-stage)
 *     The IR carries `requestedOccurrence` only when the user *explicitly*
 *     specified an occurrence directive (NL always; JSON only when the
 *     `occurrence` field is present in the public op). The executor does
 *     not honor occurrence selection today: the replace path picks the
 *     first match and refuses with `ambiguous_match` when more than one
 *     exists, regardless of what the user asked for. Pre-#45, "all" and
 *     "Nth" directives on the NL surface were either dropped silently or
 *     refused at spec-load with a message pointing the user to
 *     `--json` / `batch` (which also drops the field). Pre-#45 on the
 *     JSON surface, the `occurrence` field was advertised by
 *     `usesteady capabilities` but silently stripped at parse.
 *
 *     The validator now refuses at validate-stage when the user's
 *     explicit directive is "all" or `{ index: N }`, with a diagnostic
 *     that quotes the directive verbatim. The "first" case still flows
 *     through to the executor unchanged (preserves today's accidental-
 *     success path for 1-match files; the executor still refuses on
 *     >1-match content as before). Same public `ambiguous_match` code
 *     as the executor refusal — §6.5.1 rule 3 / §6.6.1 rule 7.
 *
 * Hard rules:
 *
 *   1. The validator MUST NOT open files. It runs only on IR + path-level
 *      `fs` stat (`existsSync`, `lstatSync`). Anything that requires
 *      `readFileSync`/`readFile` is execute-time. (§6.5.1 rule 1.)
 *
 *   2. The validator does NOT replace the executor's guards. The executor
 *      keeps every existing pre-execution check as TOCTOU defense-in-depth.
 *      (§6.5.1 rule 2.)
 *
 *   3. Validator-stage and execute-stage error codes are identical for
 *      the same root cause. (§6.5.1 rule 3.)
 *
 *   4. `append`/`prepend` deliberately have NO missing-target check at
 *      either stage — their existing semantics are *create-if-missing*
 *      (matching POSIX `>>`). The validator never refuses these ops on
 *      missing target.
 *
 *   5. Symlink/binary errorCode harmonization across all fs ops is OUT OF
 *      SCOPE for M3. M3 mirrors the existing inconsistency (validator
 *      emits `merge_conflict` for symlink only on `write_file`/`rename`,
 *      matching the executor's existing behavior). Tracked as #224 / #225
 *      post-M3 follow-ups.
 *
 * Post-M3 widening (S1 / friction #26):
 *
 *   - `invalid_path` — byte-level path check on every path-bearing op,
 *     run BEFORE any `existsSync` / `lstatSync` probe. Refused at the
 *     validate stage when any path field contains a null byte (0x00).
 *     This is the first new validator-emitted code added after M3 ship;
 *     it follows the same hard rules above (no file reads, no stdin,
 *     no NL handling) and is documented in the public Adapter-layer
 *     enum in `src/shell/cli/use-steady.ts`. The change is purely
 *     additive — no existing op or code is rerouted.
 *
 * What this file does NOT do:
 *   - It does not own stdin (M5 / SessionController).
 *   - It does not normalize NL (M4).
 *   - It does not read file contents.
 */
import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import { canonicalizeForSafety, CanonicalizationError } from "../safety/canonicalize.js";
import { validateFilenameSafety, validateProtectedPath, } from "../safety/filename-safety.js";
import { findExtensionBearingParentSegment } from "../safety/path-segment-semantics.js";
const defaultFs = {
    existsSync,
    isSymlink: (path) => {
        try {
            return lstatSync(path).isSymbolicLink();
        }
        catch {
            return false;
        }
    },
};
// ─── Path resolution ─────────────────────────────────────────────────────────
function resolvePath(workspaceRoot, relOrAbs) {
    return isAbsolute(relOrAbs) ? relOrAbs : join(workspaceRoot, relOrAbs);
}
// ─── Path byte-level pre-check (S1 / friction #26) ───────────────────────────
//
// The first check `validateOperation` runs against any path-bearing op,
// before any `existsSync` / `lstatSync` probe. A path containing a null
// byte cannot be passed to Node's `fs` family — the runtime throws
// `TypeError [ERR_INVALID_ARG_VALUE]` from deep inside `fs.writeFileSync`
// (and friends). Pre-fix that exception was surfaced as the catchall
// `execution_error` after the SYSTEM WILL preview, after user approval,
// and after the parent directory had already been created on disk
// (`mkdirSync(..., { recursive: true })` succeeded; the file write threw).
//
// This guard refuses such paths at the validate stage with the new
// `invalid_path` code, before preview / approval / any fs side effect.
//
// Scope (matches user lock for #26):
//   - create.args.path
//   - delete.args.path
//   - rename.args.from, rename.args.to
//   - replace.args.file
//   - append.args.file
//   - prepend.args.file
//   - create_dir.args.path  (path-bearing; reachable from NL and from
//                            --json / batch post-alpha.47 contract repair)
//
// Out of scope:
//   - replace.args.from / replace.args.to are CONTENT, not paths. A NUL
//     byte in replacement content can be legitimate (some files want it).
//   - run.args.command is a shell command string, not a path. Its own
//     execute-time validation already refuses NUL via the OS.
const NUL = "\u0000";
function pathHasNullByte(p) {
    return p.includes(NUL);
}
// Render a path with NUL bytes escaped for safe display. Some terminals
// silently swallow NUL on render (or render it as a space), which would
// reproduce the same UI lie this fix is meant to eliminate. Other control
// bytes are left untouched — the user-visible "invalid byte" check is
// scoped to NUL only per the #26 lock.
function renderPathForMsg(p) {
    return p.replace(/\u0000/g, "\\x00");
}
function makeInvalidPathError(op, path, field) {
    return {
        stage: "validate",
        code: "invalid_path",
        message: `Refusing to execute: ${field} contains null byte (0x00): ${renderPathForMsg(path)}`,
        operation: op,
    };
}
/**
 * Walk the path-bearing fields of an op and return an `invalid_path`
 * error on the first NUL-bearing field, or `null` if the op is clean.
 *
 * Field-naming convention in the message text mirrors the public JSON
 * schema (the names the user typed — `file`, `from`, `to`, `path`)
 * rather than the internal IR `args` keys, so the diagnostic is
 * actionable for the human who wrote the op.
 */
function checkPathBytes(op) {
    switch (op.type) {
        case "create": {
            if (pathHasNullByte(op.args.path))
                return makeInvalidPathError(op, op.args.path, "file");
            return null;
        }
        case "create_dir": {
            if (pathHasNullByte(op.args.path))
                return makeInvalidPathError(op, op.args.path, "path");
            return null;
        }
        case "delete": {
            if (pathHasNullByte(op.args.path))
                return makeInvalidPathError(op, op.args.path, "file");
            return null;
        }
        case "rename": {
            if (pathHasNullByte(op.args.from))
                return makeInvalidPathError(op, op.args.from, "from");
            if (pathHasNullByte(op.args.to))
                return makeInvalidPathError(op, op.args.to, "to");
            return null;
        }
        case "replace": {
            if (pathHasNullByte(op.args.file))
                return makeInvalidPathError(op, op.args.file, "file");
            return null;
        }
        case "append": {
            if (pathHasNullByte(op.args.file))
                return makeInvalidPathError(op, op.args.file, "file");
            return null;
        }
        case "prepend": {
            if (pathHasNullByte(op.args.file))
                return makeInvalidPathError(op, op.args.file, "file");
            return null;
        }
        case "run": {
            // Not a path. Out of scope for #26.
            return null;
        }
    }
}
// ─── Workspace containment pre-check (S2 / friction #36) ─────────────────────
//
// The second check `validateOperation` runs against any path-bearing op,
// after the byte-level check (#26) and before any `existsSync`/`lstatSync`
// probe. The validator's `resolvePath` helper deliberately honors absolute
// paths verbatim — that single line is what allowed JSON / batch ops with
// absolute targets (POSIX `/etc/x`, Windows `C:\…` or `C:/…`, drive-relative
// `C:foo`, UNC `\\srv\share\…`) to flow through to `CursorInProcessAdapter`
// and mutate the filesystem outside the workspace at exit-0 success, with
// no safety block, no error code, no telemetry signal. The safety gate
// caught the textual `../` form via regex on the synthesized task input,
// but absolute / drive / UNC / post-normalize-`..` forms slipped through.
//
// This guard refuses such paths at the validate stage with the new
// `outside_workspace` code, before preview / approval / any fs side
// effect. The defense-in-depth re-check at `CursorInProcessAdapter`
// (per-fs-op) covers any future surface that bypasses the validator —
// matching K4's posture (see `fsChangePathsAreContained` in
// `src/kernel/execution-replay.ts`; K4-I3 does not depend on a single
// check site).
//
// Shape predicate: a path "escapes" the workspace iff ANY of:
//   - `path.isAbsolute(p)` (POSIX `/…`, Windows `C:\…` on Windows hosts)
//   - drive-rooted form matched by `/^[a-zA-Z]:[\\\/]/` (catches `C:\…`
//     and `C:/…` on POSIX hosts where `isAbsolute` returns false)
//   - drive-relative form matched by `/^[a-zA-Z]:(?![\\\/])/` (catches
//     `C:foo`, which on Windows resolves against the drive's CWD —
//     functionally equivalent to drive-rooted for our purposes)
//   - UNC form (`\\srv\share\…` or `//srv/share/…`)
//   - after fold-to-forward-slash + posix.normalize, the result equals
//     `..` or starts with `../` (catches `a/../../etc`, `..\\..\\foo`,
//     `./../etc`, and the symmetric backslash variants)
//
// Algorithm mirrors `isContainedRelativePath` in `src/kernel/classifier.ts`
// (the K4 defense, already battle-tested by K4 regression tests). It is
// re-implemented here rather than imported because:
//   1. The K4 predicate returns true-iff-contained; this fix needs the
//      reasoned dual ("escape why"), enabling the per-shape diagnostic
//      message future iterations may want.
//   2. The validator must not depend on `src/kernel/*` (M3 boundary).
//   3. Drive-relative `C:foo` is a #36-specific addition (the K4
//      predicate did not include it because K4's input shape — replay
//      artifacts — is structurally less varied).
//
// Scope (matches user lock for #36):
//   - create.args.path
//   - create_dir.args.path
//   - delete.args.path
//   - rename.args.from, rename.args.to
//   - replace.args.file
//   - append.args.file
//   - prepend.args.file
//
// Out of scope (deferred to follow-ups):
//   - run.args.command — not a path; shell quoting/escapes are
//     execute-time concerns.
//   - Symlink-inside-workspace pointing OUTSIDE workspace (TOCTOU
//     realpath check) — separate ticket; not folded into #36.
//   - NL grammar changes — the NL normalizer's parser refuses quoted
//     absolute paths today as `parse_error` at the normalize stage;
//     the validator catches anything that does materialize.
const DRIVE_ROOTED = /^[a-zA-Z]:[\\/]/;
const DRIVE_RELATIVE = /^[a-zA-Z]:(?![\\/])/;
const UNC_BACKSLASH = "\\\\";
const UNC_FORWARD_SLASH = "//";
/**
 * Cluster B — canonicalize the path before pattern checks so that
 * zero-width / bidi / NFKC-equivalent forms cannot bypass the
 * containment patterns. The byte-level NUL check above runs on the
 * original (the OS sees the original), so canonicalization must NOT
 * be applied earlier. Original `p` continues to flow to `resolvePath`
 * and the actual `fs.*` calls — canonicalization here is a detector
 * view, not a runtime substitution.
 *
 * If canonicalization itself fails (non-string, normalization error),
 * fail-closed: treat the path as escaping. This matches Row 1's
 * fail-closed contract.
 */
function checkEscape(p) {
    if (typeof p !== "string" || p.length === 0)
        return false;
    if (isAbsolute(p))
        return true;
    if (DRIVE_ROOTED.test(p))
        return true;
    if (DRIVE_RELATIVE.test(p))
        return true;
    if (p.startsWith(UNC_BACKSLASH))
        return true;
    if (p.startsWith(UNC_FORWARD_SLASH))
        return true;
    // Fold backslashes so a Windows-authored IR with `targetFiles:
    // ["..\\..\\etc"]` is rejected on any host. posix.normalize collapses
    // `a/b/../../etc` to `../etc`.
    const normalized = posix.normalize(p.replace(/\\/g, "/"));
    if (normalized === ".." || normalized.startsWith("../"))
        return true;
    return false;
}
function pathEscapesWorkspace(p) {
    // Original-form check (existing behavior, preserved verbatim).
    if (checkEscape(p))
        return true;
    // Cluster B addition: canonical-form check. A path that visually
    // contains `../` but is wrapped in zero-width joiners, BIDI
    // overrides, or fullwidth/compat variants would otherwise sneak
    // past the original-form regexes. By also testing the canonical
    // form, every adjacent surface that consults pathEscapesWorkspace
    // sees the same containment verdict the safety detectors saw.
    if (typeof p !== "string" || p.length === 0)
        return false;
    let canonical;
    try {
        canonical = canonicalizeForSafety(p);
    }
    catch (err) {
        // Fail-closed: a path we cannot canonicalize is treated as
        // escaping. Same contract as Row 1's safety gate (#293).
        if (err instanceof CanonicalizationError)
            return true;
        return true;
    }
    // If canonical form differs and the canonical form escapes, that's
    // a containment bypass attempt — refuse. If canonical form is
    // identical to original, this branch is redundant (already
    // rejected above if it escaped, accepted if it didn't), so no
    // change in behavior for clean ASCII paths.
    if (canonical !== p && checkEscape(canonical))
        return true;
    return false;
}
const OUTSIDE_WORKSPACE_MSG = "Path is outside the workspace. Use a relative path inside the current workspace.";
function makeOutsideWorkspaceError(op, path, field) {
    return {
        stage: "validate",
        code: "outside_workspace",
        message: `${OUTSIDE_WORKSPACE_MSG} (${field}: ${path})`,
        operation: op,
    };
}
/**
 * Walk the path-bearing fields of an op and return an `outside_workspace`
 * error on the first field that escapes the workspace boundary, or
 * `null` if the op is contained.
 *
 * Field-naming convention mirrors `checkPathBytes` (the public JSON
 * schema names — `file`, `from`, `to`, `path`) so diagnostics are
 * actionable for the human who wrote the op.
 */
function checkPathContainment(op) {
    switch (op.type) {
        case "create": {
            if (pathEscapesWorkspace(op.args.path))
                return makeOutsideWorkspaceError(op, op.args.path, "file");
            return null;
        }
        case "create_dir": {
            if (pathEscapesWorkspace(op.args.path))
                return makeOutsideWorkspaceError(op, op.args.path, "path");
            return null;
        }
        case "delete": {
            if (pathEscapesWorkspace(op.args.path))
                return makeOutsideWorkspaceError(op, op.args.path, "file");
            return null;
        }
        case "rename": {
            if (pathEscapesWorkspace(op.args.from))
                return makeOutsideWorkspaceError(op, op.args.from, "from");
            if (pathEscapesWorkspace(op.args.to))
                return makeOutsideWorkspaceError(op, op.args.to, "to");
            return null;
        }
        case "replace": {
            if (pathEscapesWorkspace(op.args.file))
                return makeOutsideWorkspaceError(op, op.args.file, "file");
            return null;
        }
        case "append": {
            if (pathEscapesWorkspace(op.args.file))
                return makeOutsideWorkspaceError(op, op.args.file, "file");
            return null;
        }
        case "prepend": {
            if (pathEscapesWorkspace(op.args.file))
                return makeOutsideWorkspaceError(op, op.args.file, "file");
            return null;
        }
        case "run": {
            // Not a path. Out of scope for #36.
            return null;
        }
    }
}
// Exported for the executor's defense-in-depth re-check
// (CursorInProcessAdapter). Keeping the predicate in one module so the
// validator and executor can never disagree about what "outside the
// workspace" means.
export { pathEscapesWorkspace, OUTSIDE_WORKSPACE_MSG };
// ─── Filename safety pre-check (Cluster B Iteration 2 / public#50) ───────────
//
// The third pre-check `validateOperation` runs against any op whose
// path-bearing fields will MATERIALIZE a new filename on disk. Runs
// AFTER the byte-level NUL check (#26) and AFTER the workspace
// containment check (#36), but BEFORE any `existsSync` / `lstatSync`
// probe.
//
// Cluster B Iteration 1 (alpha.52) closed the path-escape obfuscation
// class via `pathEscapesWorkspace`. That predicate correctly accepts
// `src/\u202Ename.ts` as "not escaping" (the canonical form is
// `src/name.ts`, also contained). But the filename written to disk
// still carries U+202E, which is the actual security problem
// usesteady-public#50 reported (display confusion / extension
// spoofing / cross-platform breakage).
//
// `validateFilenameSafety` (in src/safety/filename-safety.ts) is the
// orthogonal check: "is this filename's textual form safe?" — runs
// regardless of whether the path escapes. The two predicates compose:
// `pathEscapesWorkspace` answers containment, `validateFilenameSafety`
// answers hygiene. Both must pass.
//
// Scope (ops that MATERIALIZE a new on-disk filename):
//   - create.args.path      → new file
//   - create_dir.args.path  → new directory
//   - rename.args.to        → new on-disk name (the rename target)
//
// Out of scope (ops that operate on a pre-existing on-disk filename):
//   - delete.args.path      → user should be able to clean up a file
//                             that already has a bad codepoint in its
//                             name; refusing here strands the user.
//   - rename.args.from      → same logic; the source name already
//                             exists.
//   - replace.args.file     → file already exists; replacement edits
//                             content, not the filename itself.
//   - append/prepend.args.file → same as replace; create-if-missing
//                                 but the *content* is what's being
//                                 written, and bad codepoints in the
//                                 filename of a brand-new file are
//                                 still rare relative to the friction
//                                 cost — deferred until real signal.
//                                 (See Phase 5 next-step list in the
//                                 CHANGELOG entry for this iteration.)
function makeInvalidFilenameError(op, path, field, detail, validatorCode) {
    // Iter 3 / 3.6: map the validator's internal discriminant to the
    // public `CliErrorCode` surface, and pick a human-readable summary
    // keyed on the *internal* discriminant. The "one new public code"
    // constraint (Iter 3 ADR) keeps everything except reserved-name
    // folded under the existing `invalid_filename_chars` umbrella.
    //
    // Iter 3.6 polish: each summary now mirrors the detail-layer
    // vocabulary so the prefix and the detail tell the same story. The
    // chars case names the three character classes (BIDI / zero-width /
    // control) that actually get refused, so users skimming only the
    // prefix understand the class.
    //
    // Iter 4: `invalid_filename_whitespace` (public#68) folds under the
    // same public `invalid_filename_chars` umbrella as the canonical-
    // divergence case. Whitespace-bounded names are a hygiene
    // refusal, same family as zero-width / BIDI / control codepoints.
    const summary = validatorCode === "invalid_filename_reserved_name"
        ? "is a Windows reserved device name"
        : validatorCode === "invalid_filename_canonical_divergence"
            ? "is not in canonical form (NFKC divergence)"
            : validatorCode === "invalid_filename_whitespace"
                ? "has leading or trailing whitespace in a path segment"
                : validatorCode === "canonicalization_failed"
                    ? "could not be safely canonicalized"
                    : "contains invisible, bidirectional, or control codepoints";
    const code = validatorCode === "invalid_filename_reserved_name"
        ? "invalid_filename_reserved_name"
        : "invalid_filename_chars";
    return {
        stage: "validate",
        code,
        message: `Refusing to ${verbForOp(op)}: ${field} ${summary}. ${detail} (${field}: ${path})`,
        operation: op,
    };
}
/**
 * Cluster B Iteration 4 / usesteady-public#60, #67 -- protected-path
 * refusal at the validate stage. Returns a `ValidateError` shape
 * matching the existing filename-safety refusals so the IR walker can
 * surface it uniformly.
 *
 * Maps the internal `prohibited_path` discriminant to the new public
 * `prohibited_path` code -- this is the one new public code Iter 4
 * introduces. Justification (per AGENTS.md "no new public codes
 * unless strongly justified"):
 *
 *   1. Distinct semantic: the path is well-formed and inside the
 *      workspace -- no other existing code matches "location is
 *      off-limits regardless of shape".
 *   2. Distinct remediation: the user is told to use `git` directly,
 *      not to rename or restructure the path. Folding under
 *      `invalid_filename_chars` would mis-route the fix.
 *   3. Programmatic consumers may want to surface a different UI for
 *      "you tried to touch git internals" vs "your filename has
 *      bidi controls".
 */
function makeProhibitedPathError(op, path, field, detail) {
    return {
        stage: "validate",
        code: "prohibited_path",
        message: `Refusing to ${verbForOp(op)}: ${field} is a protected path. ${detail} (${field}: ${path})`,
        operation: op,
    };
}
function verbForOp(op) {
    switch (op.type) {
        case "create": return "create file";
        case "create_dir": return "create directory";
        case "rename": return "rename to target";
        default: return "execute";
    }
}
// ─── Extension-bearing parent segment (#80) ──────────────────────────────────
//
// Refuse paths where an intermediate segment looks like a source/config
// filename (e.g. `src/Button.tsx/index.ts` would mkdir `Button.tsx/`).
// Basename files (`src/components/Button.tsx`) are allowed — only parent
// segments are checked. See `path-segment-semantics.ts`.
function makeExtensionBearingParentError(op, path, field, segment, extension) {
    return {
        stage: "validate",
        code: "invalid_path",
        message: `Refusing to ${verbForOp(op)}: ${field} has parent directory "${segment}" ` +
            `which looks like a filename (extension ".${extension}"), not a directory. ` +
            `(${field}: ${path})`,
        operation: op,
    };
}
function checkExtensionBearingParentForOp(op) {
    switch (op.type) {
        case "create": {
            const hit = findExtensionBearingParentSegment(op.args.path);
            if (hit === null)
                return null;
            return makeExtensionBearingParentError(op, op.args.path, "file", hit.segment, hit.extension);
        }
        case "create_dir": {
            const hit = findExtensionBearingParentSegment(op.args.path);
            if (hit === null)
                return null;
            return makeExtensionBearingParentError(op, op.args.path, "path", hit.segment, hit.extension);
        }
        case "rename": {
            const hit = findExtensionBearingParentSegment(op.args.to);
            if (hit === null)
                return null;
            return makeExtensionBearingParentError(op, op.args.to, "to", hit.segment, hit.extension);
        }
        case "delete":
        case "replace":
        case "append":
        case "prepend":
        case "run":
            return null;
    }
}
function checkFilenameSafetyForOp(op) {
    switch (op.type) {
        case "create": {
            const result = validateFilenameSafety(op.args.path);
            if (result.ok)
                return null;
            return makeInvalidFilenameError(op, op.args.path, "file", result.detail, result.code);
        }
        case "create_dir": {
            const result = validateFilenameSafety(op.args.path);
            if (result.ok)
                return null;
            return makeInvalidFilenameError(op, op.args.path, "path", result.detail, result.code);
        }
        case "rename": {
            // Only the destination (`to`) is gated -- the source must already
            // exist on disk, so its filename safety has nothing to do with
            // what we are creating.
            const result = validateFilenameSafety(op.args.to);
            if (result.ok)
                return null;
            return makeInvalidFilenameError(op, op.args.to, "to", result.detail, result.code);
        }
        case "delete":
        case "replace":
        case "append":
        case "prepend":
        case "run":
            return null;
    }
}
/**
 * Cluster B Iteration 4 -- protected-path check.
 *
 * Unlike `checkFilenameSafetyForOp` (scoped to ops that MATERIALIZE
 * a new on-disk filename), this check runs on every path-bearing op
 * because the friction shape is symmetric: `delete .git/HEAD` is
 * exactly as harmful as `create .git/HEAD`. The check enforces a
 * location-shape invariant ("the tool does not edit git internals"),
 * not a name-shape one.
 *
 * Scope (every path-bearing op):
 *   - create.args.path
 *   - create_dir.args.path
 *   - delete.args.path
 *   - rename.args.from AND args.to (both sides -- renaming `.git/HEAD`
 *     into a workspace file, or renaming any file into `.git/HEAD`,
 *     are both refused)
 *   - replace.args.file
 *   - append.args.file
 *   - prepend.args.file
 *
 * Out of scope:
 *   - run.args.command -- the protected-path rule is about file paths,
 *     not shell commands. `run` is gated by K5's allow-list and the
 *     Cluster D shell-authority anchor; protected-paths would
 *     overlap their semantics confusingly.
 */
function checkProtectedPathForOp(op) {
    switch (op.type) {
        case "create": {
            const result = validateProtectedPath(op.args.path);
            if (result.ok)
                return null;
            return makeProhibitedPathError(op, op.args.path, "file", result.detail);
        }
        case "create_dir": {
            const result = validateProtectedPath(op.args.path);
            if (result.ok)
                return null;
            return makeProhibitedPathError(op, op.args.path, "path", result.detail);
        }
        case "delete": {
            const result = validateProtectedPath(op.args.path);
            if (result.ok)
                return null;
            return makeProhibitedPathError(op, op.args.path, "file", result.detail);
        }
        case "rename": {
            const resultFrom = validateProtectedPath(op.args.from);
            if (!resultFrom.ok) {
                return makeProhibitedPathError(op, op.args.from, "from", resultFrom.detail);
            }
            const resultTo = validateProtectedPath(op.args.to);
            if (!resultTo.ok) {
                return makeProhibitedPathError(op, op.args.to, "to", resultTo.detail);
            }
            return null;
        }
        case "replace": {
            const result = validateProtectedPath(op.args.file);
            if (result.ok)
                return null;
            return makeProhibitedPathError(op, op.args.file, "file", result.detail);
        }
        case "append": {
            const result = validateProtectedPath(op.args.file);
            if (result.ok)
                return null;
            return makeProhibitedPathError(op, op.args.file, "file", result.detail);
        }
        case "prepend": {
            const result = validateProtectedPath(op.args.file);
            if (result.ok)
                return null;
            return makeProhibitedPathError(op, op.args.file, "file", result.detail);
        }
        case "run":
            return null;
    }
}
function validateCreate(op, ctx) {
    const abs = resolvePath(ctx.workspaceRoot, op.args.path);
    // Symlink-at-target check first — matches executor order in
    // CursorInProcessAdapter.executeFsOp `case "write_file"`.
    if (ctx.fs.isSymlink(abs)) {
        return {
            stage: "validate",
            code: "merge_conflict",
            message: `Refusing to write via symlink path: ${abs}`,
            operation: op,
        };
    }
    if (ctx.fs.existsSync(abs)) {
        return {
            stage: "validate",
            code: "target_exists",
            message: `Refusing to overwrite existing file: ${abs}`,
            operation: op,
        };
    }
    return null;
}
function validateCreateDir(op, ctx) {
    // Issue #49 — create_dir truthfulness. Before this check, the executor's
    // mkdirSync(..., { recursive: true }) silently succeeded on EEXIST and the
    // run reported "Completed successfully" for a no-op. The success banner
    // lied about what happened. We now refuse at validate stage with the same
    // public `target_exists` code that `create` (write_file) uses, so the
    // public surface treats existing-target the same way for both ops.
    //
    // Scope discipline: this is the existsSync mirror only. No symlink check
    // is added (would be a new refusal class — out of scope per #49). The
    // existsSync probe follows symlinks, so a symlink that resolves to an
    // existing path still surfaces as target_exists; a symlink to a
    // non-existent path passes this check (pre-existing behavior, unchanged).
    //
    // Nested-dir behavior preserved: for a new leaf with missing parents, the
    // executor's mkdirSync(..., { recursive: true }) still creates parents in
    // one shot. Only the case where the leaf path itself already exists is
    // refused here.
    const abs = resolvePath(ctx.workspaceRoot, op.args.path);
    if (ctx.fs.existsSync(abs)) {
        return {
            stage: "validate",
            code: "target_exists",
            message: `Refusing to create directory: target already exists at ${abs}`,
            operation: op,
        };
    }
    return null;
}
/**
 * usesteady-public#45 — render the user's explicit occurrence directive in
 * a form suitable for diagnostic messages and the optional JSON output
 * `requested_occurrence` field. Mirrors the NL surface phrasing
 * (`"first occurrence"`, `"all occurrences"`, `"Nth occurrence"`) so the
 * refusal echoes what the user typed.
 */
function formatRequestedOccurrence(occ) {
    if (occ === "first") {
        return { display: "first occurrence", machine: "first" };
    }
    if (occ === "all") {
        return { display: "all occurrences", machine: "all" };
    }
    const n = occ.index;
    const suffix = ordinalSuffix(n);
    return { display: `${n}${suffix} occurrence`, machine: `${n}${suffix}` };
}
/**
 * usesteady-public#45 — English ordinal suffix for an integer ≥ 1.
 * Mirrors the legacy `ordinalSuffix` in `ir-to-spec-fields.ts` so the
 * validator's diagnostic phrasing stays byte-identical to the load-
 * stage refusal phrasing that already shipped.
 */
function ordinalSuffix(n) {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13)
        return "th";
    const mod10 = n % 10;
    if (mod10 === 1)
        return "st";
    if (mod10 === 2)
        return "nd";
    if (mod10 === 3)
        return "rd";
    return "th";
}
/**
 * usesteady-public#45 — validate-stage refusal for replace ops carrying
 * an explicit non-"first" occurrence directive. See module JSDoc for the
 * rationale (executor never honors occurrence selection; the validator
 * refuses early so the user sees a truthful diagnostic that quotes their
 * directive, instead of the executor's generic `ambiguous_match` against
 * `from`).
 *
 * Scope discipline:
 *   - Only fires when `requestedOccurrence` is *explicitly* set. The
 *     existing no-directive path on JSON (where the adapter defaults
 *     `occurrence: "all"` but `requestedOccurrence` is undefined) is
 *     untouched — preserves byte-identical behavior for JSON callers
 *     who did not provide the field.
 *   - `requestedOccurrence === "first"` is NOT refused. Preserves the
 *     accidental-success path for 1-match files (execution remains
 *     uniqueness-only — the executor never selects among multiple
 *     matches). The executor's >1-match refusal remains unchanged
 *     — out of scope per task #45 brief ("no executor changes").
 *   - Public `ambiguous_match` code reused; no new error code minted.
 *     The user-visible message is the only delta vs the executor's
 *     >1-match refusal — and it is strictly more truthful because it
 *     quotes the user's directive.
 */
function validateReplace(op) {
    const req = op.args.requestedOccurrence;
    if (req === undefined)
        return null;
    if (req === "first")
        return null;
    const formatted = formatRequestedOccurrence(req);
    return {
        stage: "validate",
        code: "ambiguous_match",
        message: `Refusing to apply replace in "${op.args.file}": you requested ` +
            `"${formatted.display}", but the executor does not honor occurrence ` +
            "selection today (execution is uniqueness-only: the replace runs " +
            "only when the target text matches exactly once and refuses with " +
            "ambiguous_match when more than one exists — it never selects the " +
            "first of several matches). Tracked at usesteady-public#45. " +
            "Workaround: narrow `from` to a unique span, or apply the change " +
            "manually for now.",
        operation: op,
    };
}
function validateDelete(op, ctx) {
    const abs = resolvePath(ctx.workspaceRoot, op.args.path);
    // §6.5.2 deliberate refinement: delete-missing surfaces file_not_found
    // from the validate stage. Before M3 this surfaced as execution_error
    // (the executor's outer catch on ENOENT). The new behavior is
    // documented in the public Adapter-layer enum.
    if (!ctx.fs.existsSync(abs)) {
        return {
            stage: "validate",
            code: "file_not_found",
            message: `File not found: ${abs}`,
            operation: op,
        };
    }
    return null;
}
function validateRename(op, ctx) {
    const absFrom = resolvePath(ctx.workspaceRoot, op.args.from);
    const absTo = resolvePath(ctx.workspaceRoot, op.args.to);
    // Symlink-on-either-side check first — matches executor order in
    // CursorInProcessAdapter.executeFsOp `case "rename"`.
    if (ctx.fs.isSymlink(absFrom) || ctx.fs.isSymlink(absTo)) {
        return {
            stage: "validate",
            code: "merge_conflict",
            message: `Refusing to rename symlink path: ${absFrom} -> ${absTo}`,
            operation: op,
        };
    }
    if (ctx.fs.existsSync(absTo)) {
        return {
            stage: "validate",
            code: "target_exists",
            message: `Refusing to rename over existing destination: ${absTo}`,
            operation: op,
        };
    }
    return null;
}
function resolveContext(ctx) {
    return { workspaceRoot: ctx.workspaceRoot, fs: ctx.fs ?? defaultFs };
}
/**
 * Validate a single IR `Operation` against the current filesystem state.
 *
 * Returns `null` if the op is feasible at the validate stage, or a
 * `ValidateError` (without `index` — caller fills it in if walking an IR)
 * if the op should be refused before execution.
 *
 * The returned error's `code` is one of `target_exists`, `file_not_found`,
 * `merge_conflict` (M3 validator-emitted subset), or `invalid_path` (S1 /
 * #26 widening — null byte in any path-bearing field). All are documented
 * in `cli-error.ts`.
 */
export function validateOperation(op, context) {
    // S1 / friction #26 — byte-level path check FIRST, before any fs probe.
    // A NUL-byte path can never reach a successful `fs.*` call; refuse here
    // so the caller never previews, prompts, or creates parent directories
    // for an op that the OS would reject. See `checkPathBytes` above.
    const pathBytesError = checkPathBytes(op);
    if (pathBytesError !== null)
        return pathBytesError;
    // S2 / friction #36 — workspace containment check SECOND, before any
    // fs probe. An absolute / drive / UNC / `..`-after-normalize path
    // would silently escape the workspace via `resolvePath`'s
    // `isAbsolute(p) ? p : join(workspaceRoot, p)` shortcut, then write
    // outside the boundary at executor time. Refuse here so neither the
    // validator's `existsSync`/`lstatSync` probe nor the executor's
    // `mkdirSync(..., { recursive: true })` ever runs against an
    // unbounded path. See `checkPathContainment` above.
    const containmentError = checkPathContainment(op);
    if (containmentError !== null)
        return containmentError;
    // usesteady-public#80 — extension-bearing parent segment refusal.
    // Runs before any fs probe so mkdirSync never materializes a directory
    // named like a source file (e.g. `src/Button.tsx/`).
    const extensionParentError = checkExtensionBearingParentForOp(op);
    if (extensionParentError !== null)
        return extensionParentError;
    // Cluster B Iteration 2 / usesteady-public#50 -- filename hygiene
    // check THIRD, before any fs probe. Orthogonal to containment.
    // Refuses ops that would create a new on-disk filename containing
    // invisible / BIDI / control codepoints, or whose canonical form
    // diverges from the original (NFKC compatibility variants like
    // fullwidth Latin). Scoped to create / create_dir / rename.to --
    // see `checkFilenameSafetyForOp` above for the scope rationale.
    const filenameSafetyError = checkFilenameSafetyForOp(op);
    if (filenameSafetyError !== null)
        return filenameSafetyError;
    // Cluster B Iteration 4 / usesteady-public#60, #67 -- protected-
    // path check FOURTH, before any fs probe. Orthogonal to the three
    // prior checks: a path can be NUL-byte-clean, in-workspace, and
    // filename-hygienic and still refuse to be touched if its location
    // matches a protected pattern (.git/ in V1). Runs on every path-
    // bearing op including `delete` -- see `checkProtectedPathForOp`
    // above for the scope rationale.
    const protectedPathError = checkProtectedPathForOp(op);
    if (protectedPathError !== null)
        return protectedPathError;
    const ctx = resolveContext(context);
    switch (op.type) {
        case "create": return validateCreate(op, ctx);
        case "create_dir": return validateCreateDir(op, ctx);
        case "delete": return validateDelete(op, ctx);
        case "rename": return validateRename(op, ctx);
        case "replace": return validateReplace(op);
        case "append": return null; // create-if-missing
        case "prepend": return null; // create-if-missing
        case "run": return null; // intrinsically execute-time
    }
}
/**
 * Walk an IR's operations and return the first `ValidateError`, or `null`
 * if every op passes. Per design §6.4 ("if a stage returns a structured
 * error, the next stage is never invoked"), the walker stops at the first
 * failure.
 *
 * Multi-op semantics: this function does NOT model the side effects of
 * earlier ops in the same IR. It checks every op against the current
 * filesystem state. Intra-IR conflicts (e.g. `[create foo, rename bar to foo]`
 * where neither op is infeasible at start) are caught by the executor's
 * defense-in-depth at execute time — not here. The validator's job is
 * pre-flight, not simulation.
 *
 * The behavior change for multi-op IRs where an op[i] fails validation:
 * before M3, ops [0..i-1] would execute and op[i] would fail at the
 * executor; after M3, no ops execute. This is more atomic and is acceptable
 * because no existing test pinned the partial-execution behavior. See the
 * M3 PR description and design §6.5 for the analysis.
 */
export function validateIR(ir, context) {
    const ctx = resolveContext(context);
    for (let i = 0; i < ir.operations.length; i++) {
        const op = ir.operations[i];
        const partial = validateOperation(op, ctx);
        if (partial !== null) {
            return { ...partial, index: i };
        }
    }
    return null;
}
//# sourceMappingURL=feasibility-validator.js.map