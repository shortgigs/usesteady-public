/**
 * effect-closure.ts — CREATE_DIR_EFFECT_CONTRACT_V1
 *
 * Canonical contract: docs/product/CREATE_DIR_EFFECT_CONTRACT_V1.md
 *
 *   permittedEffects = ancestorClosure(target, scopeRoot)
 *                     = { target } ∪ { proper lexical ancestors of target
 *                                      strictly inside scopeRoot }
 *
 * This module is the SINGLE derivation of the create_dir permitted-effect set.
 * Every pre-approval authority surface (CLI preview, web approval card via the
 * server, execution-review) and the completeness observer derive from this one
 * function. If any surface can produce a different permitted set from the same
 * approved target, that is a contract violation — STOP (contract §4).
 *
 * Properties (pinned by tests/workflow/effect-closure.test.ts):
 *   - pure: a function of the target string and scope root only;
 *   - deterministic: no filesystem reads, no clock, no environment;
 *   - lexical: ancestors are derived from the path text, never from disk state;
 *   - hash-bound by construction: the spec hash binds targetFiles verbatim, and
 *     the closure reads only the same targetFiles[0] (+ scope), so the disclosed
 *     set is anchored to exactly what approval binds;
 *   - fail-closed: returns null when the closure cannot be derived inside scope
 *     (scope escape, absolute target without an in-scope root); callers must then
 *     disclose generically (CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE) rather than
 *     present an incomplete list as complete.
 *
 * Return ordering: shallow → deep, with the target itself LAST. Callers needing
 * ancestors-only use `closure.slice(0, -1)`.
 *
 * Scope: create_dir only. write_file / append_file / prepend_file share the
 * recursive-mkdir parent-creation behavior and are SEPARATELY UNRESOLVED —
 * do not reuse this module for them without their own contract (contract §5).
 */
/**
 * Generic disclosure used when the exact closure cannot be derived
 * (fail-closed; never present an incomplete list as complete).
 */
export const CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE = "may also create missing ancestor directories within the authorized scope";
/**
 * Compute the permitted-effect set for a create_dir target:
 * `{ target } ∪ { proper lexical ancestors strictly inside scope }`.
 *
 * @param target     The approved target path (workspace-relative in the normal
 *                   pipeline; absolute paths are relativized against scopeRoot).
 * @param scopeRoot  Optional. Only consulted for absolute targets.
 * @returns The closure ordered shallow → deep with the target LAST, or null
 *          when the target escapes scope / cannot be normalized in-scope.
 */
export function ancestorClosure(target, scopeRoot) {
    const rel = relativizeToScope(target, scopeRoot);
    if (rel === null)
        return null;
    const segments = normalizeSegments(rel);
    if (segments === null || segments.length === 0)
        return null;
    const out = [];
    for (let i = 1; i <= segments.length; i++) {
        out.push(segments.slice(0, i).join("/"));
    }
    return out;
}
/**
 * Format an ancestor list for display: ["a", "a/b"] → "a/, a/b/".
 * The trailing slash marks directories. One formatter for every surface so a
 * rendered list is byte-identical wherever it appears.
 */
export function formatAncestorDirs(ancestors) {
    return ancestors.map((a) => `${a}/`).join(", ");
}
export function fsOpEffectDisclosure(op) {
    if (op.operationType !== "create_dir")
        return undefined;
    const closure = ancestorClosure(op.dirPath);
    return {
        target: op.dirPath,
        ancestors: closure === null ? null : closure.slice(0, -1),
    };
}
// ─── internals ────────────────────────────────────────────────────────────────
/**
 * Lexically normalize a relative path: unify separators, drop "." segments,
 * resolve ".." by popping. Returns null when the path escapes above its root
 * (leading "..") — a scope escape, which containment refuses independently.
 */
function normalizeSegments(path) {
    const stack = [];
    for (const part of path.split("/")) {
        if (part === "" || part === ".")
            continue;
        if (part === "..") {
            if (stack.length === 0)
                return null;
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    return stack;
}
/**
 * Express `target` relative to scope. Relative targets pass through unchanged
 * (the normal pipeline: targetFiles are workspace-relative, and the closure of
 * a relative target is root-independent — the same set under any scopeRoot).
 * Absolute targets are relativized against scopeRoot; comparison of the root
 * prefix is case-insensitive (Windows drive paths). Returns null when an
 * absolute target is not strictly inside scopeRoot, or no scopeRoot is given.
 */
function relativizeToScope(target, scopeRoot) {
    const t = target.replace(/\\/g, "/");
    const isAbsolute = t.startsWith("/") || /^[A-Za-z]:\//.test(t);
    if (!isAbsolute)
        return t;
    if (scopeRoot === undefined)
        return null;
    const rootSegs = normalizeSegments(scopeRoot.replace(/\\/g, "/"));
    const targetSegs = normalizeSegments(t);
    if (rootSegs === null || targetSegs === null)
        return null;
    if (targetSegs.length <= rootSegs.length)
        return null;
    for (let i = 0; i < rootSegs.length; i++) {
        if (rootSegs[i].toLowerCase() !== targetSegs[i].toLowerCase())
            return null;
    }
    return targetSegs.slice(rootSegs.length).join("/");
}
//# sourceMappingURL=effect-closure.js.map