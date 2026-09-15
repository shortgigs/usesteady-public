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

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecutableOperation, ScopeSnapshotEntry } from "../types.js";

// ─── Deterministic ordering ─────────────────────────────────────────────────

/** Code-unit comparison — stable across platforms and locales (no localeCompare). */
function cmpCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Path resolution (observer-side; deliberately NOT the executor's code) ───

const SENTINEL_ROOT = "/__usesteady_scope_root__";

/**
 * Normalize a workspace-relative path the way the actuation/verification
 * layers land on it (interior `..` resolved), returning POSIX-style segments.
 * Throws on absolute paths and on paths that escape the root. The empty/root
 * path yields [] (a scope root MAY be the workspace root itself).
 */
function normalizeParts(p: string): readonly string[] {
  if (typeof p !== "string" || p.trim().length === 0) {
    throw new Error("empty path");
  }
  if (isAbsolute(p)) {
    throw new Error("absolute path");
  }
  const rel = relative(SENTINEL_ROOT, resolve(SENTINEL_ROOT, p));
  if (rel === "") return [];
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("path escapes the workspace root");
  }
  return rel.split(sep).filter((seg) => seg.length > 0);
}

/** Normalize to a POSIX-style workspace-relative string ("." for the root). */
function normalizeRel(p: string): string {
  const parts = normalizeParts(p);
  return parts.length === 0 ? "." : parts.join("/");
}

// ─── Scope derivation (pure) ────────────────────────────────────────────────

/** The op kinds that mutate the filesystem (attestations/documents do not). */
const FS_OP_KINDS: ReadonlySet<string> = new Set([
  "create_dir",
  "create_file",
  "replace_in_file",
  "delete_file",
  "rename_file",
]);

function parentScopeOf(rel: string): string {
  if (rel === ".") return ".";
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "." : rel.slice(0, idx);
}

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
export function deriveObservationScope(ops: readonly ExecutableOperation[]): readonly string[] {
  const scopes = new Set<string>();
  for (const op of ops) {
    if (!FS_OP_KINDS.has(op.kind)) continue;
    const paths: string[] = op.kind === "rename_file" ? [op.path, op.toPath] : [op.path];
    for (const p of paths) {
      let rel: string;
      try {
        rel = normalizeRel(p);
      } catch {
        rel = "."; // unobservable/unsafe target — widest truthful in-sandbox net
      }
      scopes.add(parentScopeOf(rel));
    }
  }
  return [...scopes].sort(cmpCodeUnit);
}

// ─── Snapshot (observer read path) ──────────────────────────────────────────

function sha256HexBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256HexText(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Recursively record one path and (for directories) everything beneath it.
 * `seen` dedupes overlapping scope roots. Never follows symlinks. Never throws
 * per-entry: unreadable entries are recorded as "inaccessible".
 */
function walkInto(abs: string, rel: string, entries: ScopeSnapshotEntry[], seen: Set<string>): void {
  if (seen.has(rel)) return;
  seen.add(rel);

  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(abs);
  } catch {
    // Exists in a listing but cannot be stat-read (or the scope root itself is
    // unreadable): record the gap — never silently skip.
    entries.push({ path: rel, kind: "inaccessible" });
    return;
  }

  if (st.isSymbolicLink()) {
    let targetHash: string | undefined;
    try {
      targetHash = sha256HexText(readlinkSync(abs));
    } catch {
      targetHash = undefined; // link present but target unreadable — presence still recorded
    }
    entries.push(
      targetHash === undefined
        ? { path: rel, kind: "symlink" }
        : { path: rel, kind: "symlink", sha256: targetHash },
    );
    return;
  }

  if (st.isDirectory()) {
    entries.push({ path: rel, kind: "dir" });
    let names: readonly string[];
    try {
      names = readdirSync(abs);
    } catch {
      // The directory exists but its contents cannot be listed. Downgrade the
      // marker so the gap is explicit in the record (a later readable listing
      // surfaces as a modification + additions) — never a silent skip.
      entries[entries.length - 1] = { path: rel, kind: "inaccessible" };
      return;
    }
    const sorted = [...names].sort(cmpCodeUnit);
    for (const name of sorted) {
      walkInto(join(abs, name), rel === "." ? name : `${rel}/${name}`, entries, seen);
    }
    return;
  }

  if (st.isFile()) {
    let hash: string | undefined;
    try {
      hash = sha256HexBytes(readFileSync(abs));
    } catch {
      hash = undefined;
    }
    if (hash === undefined) {
      entries.push({ path: rel, kind: "inaccessible" });
    } else {
      entries.push({ path: rel, kind: "file", sha256: hash });
    }
    return;
  }

  entries.push({ path: rel, kind: "other" });
}

/**
 * Capture a deterministic snapshot of the declared observation scope.
 * Observer read path — the only writer of scope-snapshot evidence.
 *
 * `workspaceRoot` is realpath'd once; a missing root THROWS (the caller treats
 * it as a failed capture, never as agreement). Scope roots are validated
 * against the same containment rule as op paths; an invalid scope root throws
 * (it can only come from kernel-side derivation, so this is a bug, not data).
 */
export function snapshotFsScope(
  workspaceRoot: string,
  scopeRoots: readonly string[],
): readonly ScopeSnapshotEntry[] {
  const rootReal = realpathSync(resolve(workspaceRoot));
  const entries: ScopeSnapshotEntry[] = [];
  const seen = new Set<string>();
  for (const scope of scopeRoots) {
    const parts = normalizeParts(scope); // "." -> [] (the root itself)
    const rel = parts.length === 0 ? "." : parts.join("/");
    const abs = parts.length === 0 ? rootReal : join(rootReal, ...parts);
    let exists = true;
    try {
      lstatSync(abs);
    } catch {
      exists = false; // absent scope root: contributes no entries (authorized create target)
    }
    if (exists) walkInto(abs, rel, entries, seen);
  }
  // The workspace root marker "." is structural, not evidence — drop it so the
  // snapshot holds only real entries beneath it.
  return entries
    .filter((e) => e.path !== ".")
    .sort((a, b) => cmpCodeUnit(a.path, b.path));
}

// ─── Diff + reconciliation (pure) ───────────────────────────────────────────

export type ScopeDiff = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  readonly unchanged: readonly string[];
};

function entryKey(e: ScopeSnapshotEntry): string {
  return `${e.kind}${e.sha256 ?? ""}`;
}

/** Diff two snapshots by path. Pure and deterministic. */
export function diffScopeSnapshots(
  pre: readonly ScopeSnapshotEntry[],
  post: readonly ScopeSnapshotEntry[],
): ScopeDiff {
  const preMap = new Map(pre.map((e) => [e.path, e]));
  const postMap = new Map(post.map((e) => [e.path, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];
  for (const [path, postEntry] of postMap) {
    const preEntry = preMap.get(path);
    if (preEntry === undefined) {
      added.push(path);
    } else if (entryKey(preEntry) !== entryKey(postEntry)) {
      modified.push(path);
    } else {
      unchanged.push(path);
    }
  }
  for (const path of preMap.keys()) {
    if (!postMap.has(path)) removed.push(path);
  }
  return {
    added: added.sort(cmpCodeUnit),
    removed: removed.sort(cmpCodeUnit),
    modified: modified.sort(cmpCodeUnit),
    unchanged: unchanged.sort(cmpCodeUnit),
  };
}

/**
 * The paths an approved op set is authorized to change: every filesystem op
 * target (both ends of a rename) PLUS every ancestor directory of those
 * targets — the executor's create ops materialize missing parent chains
 * (mkdirp), so an ancestor's appearance is part of the authorized delta, not
 * collateral. Normalization matches the actuation path resolution.
 */
export function authorizedDeltaPaths(ops: readonly ExecutableOperation[]): ReadonlySet<string> {
  const authorized = new Set<string>();
  for (const op of ops) {
    if (!FS_OP_KINDS.has(op.kind)) continue;
    const paths: string[] = op.kind === "rename_file" ? [op.path, op.toPath] : [op.path];
    for (const p of paths) {
      let rel: string;
      try {
        rel = normalizeRel(p);
      } catch {
        continue; // unobservable target; the executor refuses it — no delta to authorize
      }
      if (rel === ".") continue;
      authorized.add(rel);
      let ancestor = parentScopeOf(rel);
      while (ancestor !== ".") {
        authorized.add(ancestor);
        ancestor = parentScopeOf(ancestor);
      }
    }
  }
  return authorized;
}

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
export function classifyCollateral(
  diff: ScopeDiff,
  authorized: ReadonlySet<string>,
): CollateralClassification {
  const unauthorized = (paths: readonly string[]): string[] => paths.filter((p) => !authorized.has(p));
  return {
    additions: unauthorized(diff.added),
    modifications: unauthorized(diff.modified),
    deletions: unauthorized(diff.removed),
  };
}

// ─── Pre-actuation sensor seam (wired into the execution stage) ─────────────

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
export type ScopeSensor = (
  approvedOps: readonly ExecutableOperation[],
) => ScopeSensing | null | Promise<ScopeSensing | null>;

/** Bind the scope sensor to a filesystem workspace root. */
export function makeFsScopeSensor(workspaceRoot: string): ScopeSensor {
  const rootResolved = resolve(workspaceRoot);
  return (approvedOps) => {
    const scope = deriveObservationScope(approvedOps);
    if (scope.length === 0) return null;
    return { scope, snapshot: snapshotFsScope(rootResolved, scope) };
  };
}
