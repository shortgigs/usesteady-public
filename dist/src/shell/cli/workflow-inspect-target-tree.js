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
import { posix } from "node:path";
// ─── Path normalization ─────────────────────────────────────────────────────
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
export function normalizeTargetPath(raw) {
    if (typeof raw !== "string" || raw.length === 0)
        return "";
    const folded = raw.replace(/\\/g, "/");
    const normalized = posix.normalize(folded);
    if (normalized === "/" || normalized.length === 0)
        return normalized;
    if (normalized.endsWith("/"))
        return normalized.slice(0, -1);
    return normalized;
}
// ─── IR op → contributions ──────────────────────────────────────────────────
/**
 * Extract every target-tree contribution from a single IR `Operation`.
 *
 * `run` contributes nothing (no path field).
 *
 * Pure; never throws; the IR is already typed so missing-field cases
 * cannot arise here (the IR contract enforces presence).
 */
export function contributionsForIROperation(op) {
    switch (op.type) {
        case "create":
            return [{ path: normalizeTargetPath(op.args.path), kind: "file", opType: "create" }];
        case "create_dir":
            return [{ path: normalizeTargetPath(op.args.path), kind: "dir", opType: "create_dir" }];
        case "delete":
            return [{ path: normalizeTargetPath(op.args.path), kind: "unknown", opType: "delete" }];
        case "rename":
            return [
                { path: normalizeTargetPath(op.args.from), kind: "file", opType: "rename" },
                { path: normalizeTargetPath(op.args.to), kind: "file", opType: "rename" },
            ];
        case "replace":
            return [{ path: normalizeTargetPath(op.args.file), kind: "file", opType: "replace" }];
        case "append":
            return [{ path: normalizeTargetPath(op.args.file), kind: "file", opType: "append" }];
        case "prepend":
            return [{ path: normalizeTargetPath(op.args.file), kind: "file", opType: "prepend" }];
        case "run":
            return [];
    }
}
/**
 * Build contributions for a Claude / non-deterministic task that declares
 * a `targetFiles` list. Used by the inspector to give Claude tasks a
 * tree presence without pretending they are statically predictable.
 *
 * Each declared file becomes one `non_deterministic`-tagged file
 * contribution. Tasks with no `targetFiles` produce no contributions.
 */
export function contributionsForNonDeterministicTask(targetFiles) {
    if (!targetFiles)
        return [];
    const out = [];
    for (const raw of targetFiles) {
        const p = normalizeTargetPath(raw);
        if (p.length === 0)
            continue;
        out.push({ path: p, kind: "file", opType: "non_deterministic" });
    }
    return out;
}
// ─── Merge + sort ───────────────────────────────────────────────────────────
const KIND_RANK = Object.freeze({
    // Higher rank wins on merge: "dir" beats "file" beats "unknown".
    dir: 2,
    file: 1,
    unknown: 0,
});
function mergeKind(a, b) {
    return KIND_RANK[a] >= KIND_RANK[b] ? a : b;
}
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
export function buildTargetTree(contributions) {
    const byPath = new Map();
    for (const c of contributions) {
        if (c.path.length === 0)
            continue;
        const existing = byPath.get(c.path);
        if (existing === undefined) {
            byPath.set(c.path, { kind: c.kind, ops: new Set([c.opType]) });
        }
        else {
            existing.kind = mergeKind(existing.kind, c.kind);
            existing.ops.add(c.opType);
        }
    }
    const out = [];
    for (const [path, value] of byPath.entries()) {
        const ops = [...value.ops].sort();
        out.push(Object.freeze({ path, kind: value.kind, ops: Object.freeze(ops) }));
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return Object.freeze(out);
}
// ─── Text-mode hierarchical renderer ────────────────────────────────────────
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
export function renderTargetTreeText(entries) {
    if (entries.length === 0)
        return Object.freeze([]);
    const root = { name: "", kind: "intermediate", ops: [], children: new Map() };
    for (const entry of entries) {
        const segments = entry.path.split("/").filter((s) => s.length > 0);
        if (segments.length === 0)
            continue;
        let cursor = root;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const isLeaf = i === segments.length - 1;
            let child = cursor.children.get(seg);
            if (child === undefined) {
                child = {
                    name: seg,
                    kind: isLeaf ? entry.kind : "intermediate",
                    ops: isLeaf ? entry.ops : [],
                    children: new Map(),
                };
                cursor.children.set(seg, child);
            }
            else if (isLeaf) {
                // A previously-intermediate node is now an explicit leaf; upgrade.
                child.kind = entry.kind;
                child.ops = entry.ops;
            }
            cursor = child;
        }
    }
    // Compute leaf-padding width for op-list alignment.
    let widestBasename = 0;
    for (const e of entries) {
        const tail = e.path.split("/").pop() ?? e.path;
        if (tail.length > widestBasename)
            widestBasename = tail.length;
    }
    const padCol = Math.min(Math.max(widestBasename + 2, 10), 32);
    const lines = [];
    function emit(node, depth) {
        // Sort children: directories (real or intermediate) first by name,
        // then files (and "unknown") by name. We classify a child as
        // "directory-shaped" iff it has children, OR its kind is "dir".
        const sorted = [...node.children.values()].sort((a, b) => {
            const aIsDir = a.children.size > 0 || a.kind === "dir";
            const bIsDir = b.children.size > 0 || b.kind === "dir";
            if (aIsDir && !bIsDir)
                return -1;
            if (!aIsDir && bIsDir)
                return 1;
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        for (const child of sorted) {
            const indent = "  ".repeat(depth + 1);
            const isDirShape = child.children.size > 0 || child.kind === "dir";
            if (isDirShape) {
                // Directory header line. Op list (if any, e.g. an explicit
                // create_dir leaf with children below) is shown inline after the
                // trailing slash for honesty.
                const opsSuffix = child.ops.length > 0 ? `  ${child.ops.join(", ")}` : "";
                lines.push(`${indent}${child.name}/${opsSuffix}`);
                emit(child, depth + 1);
            }
            else {
                // File / unknown leaf.
                const opsJoined = child.ops.join(", ");
                const baseLen = child.name.length;
                const pad = Math.max(padCol - baseLen, 2);
                lines.push(`${indent}${child.name}${" ".repeat(pad)}${opsJoined}`);
            }
        }
    }
    emit(root, 0);
    return Object.freeze(lines);
}
//# sourceMappingURL=workflow-inspect-target-tree.js.map