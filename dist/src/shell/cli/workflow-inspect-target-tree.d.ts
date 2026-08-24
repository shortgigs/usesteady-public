/**
 * src/shell/cli/workflow-inspect-target-tree.ts
 *
 * P7-min — Workflow Inspect target-tree builder + text-mode renderer.
 *
 * Pure. No I/O. No fs probes. The target tree is purely a derived
 * structural projection of the WorkflowSpec's task target paths — it
 * does NOT consult the workspace and does NOT check that any path
 * actually exists.
 *
 * Mechanics (locked in docs/product/p7-min-workflow-inspect-design-v1.md
 * §5):
 *
 *   - Each lowered IR Operation contributes 0..2 paths and a kind:
 *       create        → args.path     (file)
 *       create_dir    → args.path     (dir)
 *       delete        → args.path     (unknown — could be either)
 *       rename        → args.from + args.to (both file)
 *       replace       → args.file     (file)
 *       append        → args.file     (file)
 *       prepend       → args.file     (file)
 *       run           → no contribution (run has no path field)
 *
 *   - Claude / non-deterministic tasks contribute their declared
 *     targetFiles[] if present, kind: file.
 *
 *   - Path normalization: replace backslashes with forward slashes, then
 *     posix.normalize, then trim trailing "/" (except for "/" itself).
 *
 *   - Deduplication: identical normalized paths are merged into one
 *     entry; the `ops` list is deduplicated and sorted alphabetically.
 *
 *   - Kind precedence on merge: if two contributions to the same path
 *     disagree on kind, "dir" wins over "file"; "file" wins over
 *     "unknown". (Deletion's "unknown" never overrides a more specific
 *     classification.)
 *
 *   - Sort order: lexicographic by `path`, ascending.
 */
import type { Operation } from "../../input/ir.js";
export type TargetEntryKind = "file" | "dir" | "unknown";
export type TargetEntry = {
    readonly path: string;
    readonly kind: TargetEntryKind;
    /** Deduplicated, alphabetically sorted IR op types that touch this path. */
    readonly ops: readonly string[];
};
/**
 * A single contribution from a task. The builder accepts these and
 * deduplicates/merges them into `TargetEntry[]`.
 */
export type TargetContribution = {
    readonly path: string;
    readonly kind: TargetEntryKind;
    readonly opType: string;
};
/**
 * Normalize a target path for tree presentation. Pure.
 *
 *   - Backslashes folded to forward slashes (so a Windows-authored spec
 *     renders identically on any host).
 *   - `posix.normalize` collapses `./` and intermediate `..` (e.g.
 *     `a/./b` → `a/b`).
 *   - Trailing slash removed unless the path IS `/`.
 *
 * Empty / non-string input returns `""` — callers filter these out
 * before contributing them to the tree.
 */
export declare function normalizeTargetPath(raw: string): string;
/**
 * Extract every target-tree contribution from a single IR `Operation`.
 *
 * `run` contributes nothing (no path field).
 *
 * Pure; never throws; the IR is already typed so missing-field cases
 * cannot arise here (the IR contract enforces presence).
 */
export declare function contributionsForIROperation(op: Operation): readonly TargetContribution[];
/**
 * Build contributions for a Claude / non-deterministic task that declares
 * a `targetFiles` list. Used by the inspector to give Claude tasks a
 * tree presence without pretending they are statically predictable.
 *
 * Each declared file becomes one `non_deterministic`-tagged file
 * contribution. Tasks with no `targetFiles` produce no contributions.
 */
export declare function contributionsForNonDeterministicTask(targetFiles: readonly string[] | undefined): readonly TargetContribution[];
/**
 * Merge a list of contributions into a sorted, deduplicated TargetEntry
 * list.
 *
 *   - Identical normalized paths collapse into one entry.
 *   - `ops` is deduplicated and alphabetically sorted.
 *   - `kind` resolves by rank (dir > file > unknown).
 *   - Final list is lexicographically sorted by `path`.
 *
 * Empty paths are dropped (they cannot have come from a well-formed IR
 * op; they appear only from non-deterministic targetFiles that
 * normalized to empty).
 */
export declare function buildTargetTree(contributions: readonly TargetContribution[]): readonly TargetEntry[];
/**
 * Render the target tree as an indented hierarchical block for the text
 * output mode. Pure; deterministic.
 *
 * Returns the body lines only (no leading "Target tree" header, no
 * trailing blank). Caller composes the surrounding frame.
 *
 * Indentation: two spaces per directory level.
 * Sort discipline: directories first (alphabetical), then files
 * (alphabetical). Each leaf line: `<basename><padding><ops-joined>`.
 *
 * Op list pad column: dynamic — widest basename across leaves plus 2
 * spaces, capped at 32 for sanity. (The JSON output is the
 * machine-stable surface; text formatting only needs to be deterministic
 * across calls for the same input.)
 *
 * Empty input → empty array.
 */
export declare function renderTargetTreeText(entries: readonly TargetEntry[]): readonly string[];
//# sourceMappingURL=workflow-inspect-target-tree.d.ts.map