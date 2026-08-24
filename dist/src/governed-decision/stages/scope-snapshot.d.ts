/**
 * Observation-scope snapshot — Collateral Mutation Closure V1.
 *
 * ── The missing semantic this closes ─────────────────────────────────────────
 *
 *   The filesystem reality probe could verify the AUTHORIZED target reached its
 *   pinned post-state, but it could not prove there were no OTHER observable
 *   mutations. An executor that performed the approved replace AND created
 *   `config/EVIL.txt` still earned `agree`. This module provides the missing
 *   half: a deterministic snapshot of an explicitly DECLARED observation scope,
 *   taken through the observer's read path before and after invocation, and a
 *   pure reconciliation that separates the authorized delta from any
 *   unauthorized one.
 *
 * ── Approved scope, not "scan everything" ────────────────────────────────────
 *
 *   The scope is NOT the whole workspace. It is the smallest explicit
 *   filesystem scope truthfully bound to the approved operations: the sorted
 *   set of PARENT DIRECTORIES of every approved filesystem op path (both source
 *   and destination for a rename). It is a pure, deterministic derivative of
 *   the ratified ops — the same ops the constitution fingerprinted and the
 *   human approved — so the scope is known before actuation, is bound by the
 *   existing ratification anchor, and cannot be enlarged, shrunk, or
 *   substituted by the executor (the executor never sees it). Deriving it from
 *   the fingerprinted ops is exactly why NO fingerprint change is required.
 *
 *   The claim boundary is precise: "no unauthorized mutation within the
 *   directories containing the approved targets." A mutation demonstrably
 *   outside those directories is outside the claim — the record states the
 *   scope explicitly so that boundary is never ambiguous.
 *
 * ── Independence ─────────────────────────────────────────────────────────────
 *
 *   This is an OBSERVER-side module. It imports nothing from the executor and
 *   re-implements its own path resolution and disk reads. The pre-actuation
 *   snapshot is captured by the execution stage through this read path (the
 *   executor is never the source of snapshot data); the post-actuation snapshot
 *   and reconciliation run inside the reality probe.
 *
 * ── Snapshot policy (explicit, deterministic) ────────────────────────────────
 *
 *   - Paths: POSIX-style, relative to the workspace root, sorted by code unit.
 *   - Files: sha256 of raw bytes. No mtimes, no sizes, no executor metadata.
 *   - Directories: presence markers (kind "dir"), recursed into.
 *   - Symlinks: recorded (kind "symlink") with a hash of the LINK-TARGET string
 *     — never followed, so a link cannot leak the walk outside the scope; a
 *     retargeted link shows as a modification.
 *   - Anything else (socket/fifo/device): kind "other", presence-only.
 *   - Inaccessible entries (stat/read/list failed): kind "inaccessible" —
 *     RECORDED, never silently skipped; a later readable state shows as a delta.
 *   - A scope root that does not exist yet (e.g. an approved create into a new
 *     directory) contributes no entries; its post-actuation appearance is the
 *     authorized delta.
 *   - No exclusions are invented here: the sandbox executor defines no ignore
 *     policy beyond containment, so this walk inherits exactly that — every
 *     entry inside the declared scope is observed.
 *
 * ── Never throws on read ─────────────────────────────────────────────────────
 *
 *   Per-entry failures degrade to "inaccessible" entries. The only throw is a
 *   missing workspace root at realpath time (the caller — probe or execution
 *   stage — treats that as a failed capture, never as agreement).
 */
import type { ExecutableOperation, ScopeSnapshotEntry } from "../types.js";
/**
 * Derive the declared observation scope from the APPROVED ops — a pure,
 * deterministic derivative of the ratified (fingerprinted) operation set:
 * the sorted unique parent directories of every filesystem op path (both
 * source and destination for a rename). `"."` denotes the workspace root
 * itself (a root-level target legitimately scopes the root).
 *
 * An op path that cannot normalize inside the root contributes `"."`: such a
 * path can never actuate (the executor refuses it), so widening the net for
 * it is safe and never hides an authorized delta.
 *
 * Returns [] when the plan carries no filesystem operation — there is then no
 * filesystem scope to declare (honest absence).
 */
export declare function deriveObservationScope(ops: readonly ExecutableOperation[]): readonly string[];
/**
 * Capture a deterministic snapshot of the declared observation scope.
 * Observer read path — the only writer of scope-snapshot evidence.
 *
 * `workspaceRoot` is realpath'd once; a missing root THROWS (the caller treats
 * it as a failed capture, never as agreement). Scope roots are validated
 * against the same containment rule as op paths; an invalid scope root throws
 * (it can only come from kernel-side derivation, so this is a bug, not data).
 */
export declare function snapshotFsScope(workspaceRoot: string, scopeRoots: readonly string[]): readonly ScopeSnapshotEntry[];
export type ScopeDiff = {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly modified: readonly string[];
    readonly unchanged: readonly string[];
};
/** Diff two snapshots by path. Pure and deterministic. */
export declare function diffScopeSnapshots(pre: readonly ScopeSnapshotEntry[], post: readonly ScopeSnapshotEntry[]): ScopeDiff;
/**
 * The paths an approved op set is authorized to change: every filesystem op
 * target (both ends of a rename) PLUS every ancestor directory of those
 * targets — the executor's create ops materialize missing parent chains
 * (mkdirp), so an ancestor's appearance is part of the authorized delta, not
 * collateral. Normalization matches the actuation path resolution.
 */
export declare function authorizedDeltaPaths(ops: readonly ExecutableOperation[]): ReadonlySet<string>;
export type CollateralClassification = {
    readonly additions: readonly string[];
    readonly modifications: readonly string[];
    readonly deletions: readonly string[];
};
/**
 * Split a scope diff into the authorized delta (ignored here — the per-op
 * verification already judges it byte-exactly) and the UNAUTHORIZED delta:
 * any added/modified/removed path the approved ops did not name. Pure.
 */
export declare function classifyCollateral(diff: ScopeDiff, authorized: ReadonlySet<string>): CollateralClassification;
export type ScopeSensing = {
    readonly scope: readonly string[];
    readonly snapshot: readonly ScopeSnapshotEntry[];
};
/**
 * The observer-side pre-actuation sensor: given the approved ops, derive the
 * declared scope and capture its pre-state snapshot. Injected into
 * `makeExecutionPort` — the execution stage calls it BEFORE invoking the
 * executor and persists the result verbatim. The executor never sees it.
 * Returns null when the plan carries no filesystem operation (honest absence).
 */
export type ScopeSensor = (approvedOps: readonly ExecutableOperation[]) => ScopeSensing | null | Promise<ScopeSensing | null>;
/** Bind the scope sensor to a filesystem workspace root. */
export declare function makeFsScopeSensor(workspaceRoot: string): ScopeSensor;
//# sourceMappingURL=scope-snapshot.d.ts.map