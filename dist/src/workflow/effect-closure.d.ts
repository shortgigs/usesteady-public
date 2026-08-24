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
import type { FsChange } from "../understand/interpretation/types.js";
/**
 * Generic disclosure used when the exact closure cannot be derived
 * (fail-closed; never present an incomplete list as complete).
 */
export declare const CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE = "may also create missing ancestor directories within the authorized scope";
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
export declare function ancestorClosure(target: string, scopeRoot?: string): readonly string[] | null;
/**
 * Format an ancestor list for display: ["a", "a/b"] → "a/, a/b/".
 * The trailing slash marks directories. One formatter for every surface so a
 * rendered list is byte-identical wherever it appears.
 */
export declare function formatAncestorDirs(ancestors: readonly string[]): string;
/**
 * Server-side derivation of the pre-approval effect disclosure for the web
 * approval card (CREATE_DIR_EFFECT_CONTRACT_V1 §3). Returns undefined for
 * non-create_dir operations. `ancestors` is null when the closure is
 * underivable — the UI must then show the generic disclosure, never an
 * empty list (an empty list would falsely claim "no ancestors").
 */
export type FsOpEffectDisclosure = {
    readonly target: string;
    readonly ancestors: readonly string[] | null;
};
export declare function fsOpEffectDisclosure(op: FsChange): FsOpEffectDisclosure | undefined;
//# sourceMappingURL=effect-closure.d.ts.map