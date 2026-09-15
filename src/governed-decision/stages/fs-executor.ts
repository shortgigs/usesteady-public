/**
 * Sandboxed deterministic filesystem executor — Tier 1.1b.
 *
 * The FIRST real actuator wired into the governed-decision kernel. It performs
 * genuine filesystem writes for the NON-DESTRUCTIVE op subset (create_dir,
 * create_file) confined to a single workspace root. It implements the
 * `DeterministicExecutor` seam from execution.ts; the kernel spine stays
 * actuator-agnostic.
 *
 * ── Safety posture (this is real reality contact — read before changing) ──────
 *
 *   1. OFF BY DEFAULT. This executor is only ever constructed and injected by a
 *      surface that the operator explicitly opted into (CLI `--execute
 *      --workspace`, or server env `GOVERNED_EXECUTE=1` + `GOVERNED_WORKSPACE`).
 *      With no executor, execution stays honestly `unavailable`.
 *
 *   2. CONTAINMENT. Every op path is resolved against the workspace root and must
 *      stay inside it. Absolute paths, `..` traversal, and symlink escapes (via a
 *      realpath check on the deepest existing ancestor) are refused — recorded as
 *      a FAILED op, never actuated.
 *
 *   3. ALLOWLISTED + IDEMPOTENT. Allowlist is exactly create_dir + create_file +
 *      replace_in_file (L4.S1) + delete_file (A1). create_file uses
 *      exclusive-create semantics, so it NEVER overwrites a file with DIFFERENT
 *      content; an existing file with byte-identical content is a satisfied
 *      post-condition (reported `ran`, idempotent), and an existing file with
 *      different content is refused (`failed`). create_dir treats an existing
 *      directory as success. replace_in_file (the first CONTENT-MODIFYING op)
 *      is gated by the pinned pre-state hash carried ON the approved op: the
 *      target must be an existing regular file whose current content hashes to
 *      `expectedPriorSha256` (actuate) or already to `expectedPostSha256`
 *      (idempotent success — safe retry after a persistence failure); ANY
 *      other hash is refused — reality changed since approval, so the approval
 *      no longer describes this file. delete_file (the first DESTRUCTIVE op)
 *      carries the same pinned discipline: the target must hash to
 *      `expectedPriorSha256` (unlink) or be ABSENT (idempotent success — the
 *      post-condition of a delete is absence); a file with ANY other content
 *      is refused — the human never approved deleting THAT content. File-only:
 *      a directory, symlink, or other target is refused, never recursed into.
 *      rename_file (R1) carries the same pinned discipline on the SOURCE: the
 *      source must be an existing regular file whose current content hashes
 *      to `expectedPriorSha256` and the destination must be unoccupied
 *      (no-clobber); source absent AND destination present hashing to the pin
 *      is the satisfied post-condition (idempotent success — safe retry after
 *      a persistence failure). Any other state is refused. File-only; never
 *      renames directories or symlinks.
 *      This idempotency is what makes the actuate-then-persist edge safe: if
 *      persistence fails and the operator retries, re-running cannot cause
 *      additional real-world effect or a dishonest record.
 *
 *   4. HONEST DETERMINISM. Real IO is not deterministic, so this executor always
 *      reports `deterministic: false`. The record never claims determinism it
 *      does not have.
 *
 *   5. NEVER THROWS to the caller per op. Each op is actuated in a try/catch; a
 *      refusal/error degrades that op to a `failed` result with a verbatim reason.
 *      Only a missing workspace root fails the whole batch (every op failed).
 *
 *   6. FAIL-CLOSED is upstream: the spine invokes execution only when ratification
 *      is connected + approved. This executor adds containment on top; it is never
 *      a bypass of the approval gate.
 *
 * ── Threat model and its boundary (explicit — do not widen exposure past this) ─
 *
 *   IN SCOPE (fully closed): a malicious or malformed GOAL STRING must never cause
 *   a write outside the workspace root. Lexical refusal (`relSafeParts`), per-
 *   component symlink refusal + realpath containment (`safeMkdirpComponents`), a
 *   pre-write parent realpath re-check, an `O_EXCL|O_NOFOLLOW` exclusive create,
 *   and a post-create realpath verify-and-revert together close this vector.
 *
 *   OUT OF SCOPE (documented residual): a SECOND, independent local adversary with
 *   write access INSIDE the operator's own workspace who actively races the
 *   executor — swapping an intermediate directory for a symlink/junction in the
 *   sub-millisecond window between a path check and the kernel's path re-walk.
 *   Node's stable `fs` API exposes no portable `openat()`/dir-relative create, so
 *   a path-based actuator cannot make this fully race-free. The mitigations above
 *   ensure no escaped file SURVIVES when revert succeeds, and the op is always
 *   reported `failed` (never counted as `ran`), so the audit stays honest. This
 *   residual is acceptable ONLY because this tier is OFF-BY-DEFAULT, OPERATOR-RUN,
 *   and LOCALHOST-ONLY — and an attacker who already has write access inside the
 *   sandbox already has that write capability independent of UseSteady.
 *
 *   BEFORE any networked / multi-tenant / privileged actuation (Tier 1.2+):
 *   replace path-based create with `openat`-style dir-fd-relative operations (e.g.
 *   a native addon or a future Node API) so intermediate-component swaps cannot be
 *   followed at all. Until then, DO NOT expose `GOVERNED_EXECUTE=1` on a reachable
 *   host or a workspace writable by an untrusted local principal.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ExecutableOperation, ExecutionOpResult } from "../types.js";
import type { ExecutorOutcome } from "./execution.js";

/**
 * Validate an op path lexically and split it into safe components.
 *
 * Refuses empty/absolute paths, `..` traversal (any segment), and the empty
 * (root-itself) path. Returns the path segments to walk. Throws (caught per-op)
 * on refusal. This is the fast lexical gate; symlink containment is enforced
 * per-component during creation (see `safeMkdirpComponents`).
 */
function relSafeParts(p: string): readonly string[] {
  if (typeof p !== "string" || p.trim().length === 0) {
    throw new Error("empty path");
  }
  if (isAbsolute(p)) {
    throw new Error("absolute paths are not permitted in the workspace");
  }
  const target = resolve("/__root__", p);
  const rel = relative("/__root__", target);
  if (rel === "") {
    throw new Error("path resolves to the workspace root itself");
  }
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("path escapes the workspace root");
  }
  const parts = rel.split(sep).filter((s) => s.length > 0);
  for (const part of parts) {
    if (part === "..") throw new Error("path escapes the workspace root");
  }
  if (parts.length === 0) throw new Error("path resolves to the workspace root itself");
  return parts;
}

/** True when `p` (already realpath'd) is the workspace root or strictly inside it. */
function isInsideRoot(rootReal: string, p: string): boolean {
  if (p === rootReal) return true;
  const rel = relative(rootReal, p);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

/**
 * Create-and-write a NEW file with no-clobber, no-follow semantics:
 *   O_CREAT | O_EXCL  → fail closed if anything already occupies the path
 *                       (defeats a leaf created in the race window),
 *   O_WRONLY          → write only,
 *   O_NOFOLLOW        → the kernel refuses to open the final component if it is
 *                       a symlink, eliminating the leaf-symlink TOCTOU even after
 *                       our own lstat. `O_NOFOLLOW` is 0 on platforms that lack
 *                       it (Windows), where file-leaf symlinks are not the junction
 *                       vector and the parent realpath check already contains us.
 */
function exclusiveNoFollowWrite(target: string, content: string): void {
  const flags =
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_WRONLY |
    (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(target, flags, 0o644);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

/**
 * Create the directory chain `parts` under `rootReal`, ONE component at a time,
 * refusing to follow ANY reparse that escapes the sandbox — the core guarantee.
 *
 * For each component we `lstat` (never `stat`, so a symlink is seen as a symlink):
 *   - missing      → `mkdirSync` NON-recursively (so it is created literally
 *                    under the current real dir; a concurrent symlink created in
 *                    the race window makes this throw EEXIST → fail closed).
 *   - symlink      → refuse (would let us escape the sandbox).
 *   - directory    → descend (idempotent: an already-present dir is fine).
 *   - anything else→ refuse (a file where a dir is needed).
 *
 * After each descent the component's REAL path (`realpathSync`) must still be
 * inside `rootReal`. This is what catches reparse points that `isSymbolicLink()`
 * does NOT flag — notably Windows directory junctions (which appear as ordinary
 * directories) and Unix bind mounts — closing the remaining containment hole.
 *
 * Returns the absolute path of the final dir.
 */
function safeMkdirpComponents(rootReal: string, parts: readonly string[]): string {
  let cur = rootReal;
  for (const part of parts) {
    const next = join(cur, part);
    let st: ReturnType<typeof lstatSync> | null;
    try {
      st = lstatSync(next);
    } catch {
      st = null;
    }
    if (st === null) {
      mkdirSync(next); // non-recursive: literal child of `cur`, never via a symlink
    } else if (st.isSymbolicLink()) {
      throw new Error("refusing to traverse a symlink inside the workspace");
    } else if (!st.isDirectory()) {
      throw new Error("path component exists and is not a directory");
    }
    // Authoritative containment: the resolved real path must stay under the root.
    // Catches junctions / reparse points / bind mounts that lstat does not flag.
    const realNext = realpathSync(next);
    if (!isInsideRoot(rootReal, realNext)) {
      throw new Error("refusing to traverse outside the workspace root (junction/reparse point)");
    }
    cur = next;
  }
  return cur;
}

/**
 * Walk the EXISTING directory chain `parts` under `rootReal` with the same
 * per-component discipline as `safeMkdirpComponents` — but NEVER creating
 * anything. Used by must-exist operations (replace_in_file): an update op whose
 * parent chain is missing must fail with zero side effects, not materialize
 * directories nobody approved.
 *
 * Per component: missing → refuse; symlink → refuse; non-directory → refuse;
 * directory → descend + authoritative realpath containment check (catches
 * junctions/reparse points lstat does not flag).
 *
 * Returns the absolute path of the final dir.
 */
function safeWalkExistingComponents(rootReal: string, parts: readonly string[]): string {
  let cur = rootReal;
  for (const part of parts) {
    const next = join(cur, part);
    let st: ReturnType<typeof lstatSync> | null;
    try {
      st = lstatSync(next);
    } catch {
      st = null;
    }
    if (st === null) {
      throw new Error("path component does not exist (update requires an existing target)");
    }
    if (st.isSymbolicLink()) {
      throw new Error("refusing to traverse a symlink inside the workspace");
    }
    if (!st.isDirectory()) {
      throw new Error("path component exists and is not a directory");
    }
    const realNext = realpathSync(next);
    if (!isInsideRoot(rootReal, realNext)) {
      throw new Error("refusing to traverse outside the workspace root (junction/reparse point)");
    }
    cur = next;
  }
  return cur;
}

/** sha256 (hex) of `content` — must match the pin sensor's hashing exactly. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Actuate one replace_in_file op with the pinned-pre-state discipline.
 *
 * Single-fd read-verify-write: the target is opened ONCE with
 * `O_RDWR | O_NOFOLLOW`; the pre-state verification and the write both go
 * through that fd, so the leaf cannot be swapped between the hash check and
 * the write (the fd is bound to the inode at open time). Refusal semantics:
 *
 *   - parent chain missing / symlinked / escaping → refuse (must-exist walk)
 *   - leaf missing, symlink, or not a regular file → refuse
 *   - current content hashes to expectedPostSha256 → satisfied post-condition
 *     (idempotent success — the safe-retry path; nothing written)
 *   - current content hashes to expectedPriorSha256 → actuate: replace every
 *     `find` occurrence and write in place through the same fd
 *   - any other hash → refuse: the file changed since approval, so the
 *     ratified approval no longer describes this file
 *
 * Returns the detail string for the `ran` result. Throws (caught per-op) on
 * every refusal.
 */
function actuateReplaceInFile(
  rootReal: string,
  parts: readonly string[],
  op: Extract<ExecutableOperation, { kind: "replace_in_file" }>,
): string {
  const dirParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1]!;
  const dirAbs = safeWalkExistingComponents(rootReal, dirParts);
  // TOCTOU defense (same as create_file): re-resolve the parent's REAL path
  // immediately before deriving the target and confirm containment.
  const realDir = realpathSync(dirAbs);
  if (!isInsideRoot(rootReal, realDir)) {
    throw new Error(
      "refusing to write: parent resolves outside the workspace root (junction/reparse point)",
    );
  }
  const target = join(realDir, fileName);

  // Inspect the final component without following it.
  let existing: ReturnType<typeof lstatSync>;
  try {
    existing = lstatSync(target);
  } catch {
    throw new Error("target file does not exist (update requires an existing file)");
  }
  if (existing.isSymbolicLink()) {
    throw new Error("refusing to write through an existing symlink");
  }
  if (!existing.isFile()) {
    throw new Error("target exists and is not a regular file");
  }

  // Open ONCE: O_NOFOLLOW closes the leaf-symlink race after the lstat above;
  // all verification and the write go through this fd.
  const flags = fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(target, flags);
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("target is not a regular file");
    }
    const current = readFileSync(fd, "utf8");
    const currentHash = sha256Hex(current);

    if (currentHash === op.expectedPostSha256) {
      // Post-condition already satisfied (retry after persistence failure, or
      // an identical earlier run). Nothing written — idempotent success.
      return `${relative(rootReal, target)} (post-state already satisfied; nothing written)`;
    }
    if (currentHash !== op.expectedPriorSha256) {
      throw new Error(
        "file content changed since approval (current content matches neither the pinned " +
          "pre-state nor the expected post-state; refusing to modify)",
      );
    }

    // The pinned pre-state holds — the approval describes exactly this content.
    // The pin sensor guaranteed `find` occurs in the pinned content.
    const post = current.split(op.find).join(op.replaceWith);
    ftruncateSync(fd, 0);
    writeSync(fd, post, 0, "utf8");
    return relative(rootReal, target);
  } finally {
    closeSync(fd);
  }
}

/**
 * Actuate one delete_file op with the pinned-pre-state discipline (A1).
 *
 * Refusal semantics:
 *
 *   - parent chain missing / symlinked / escaping → refuse (must-exist walk;
 *     with an absent parent the target is also absent — but a walk that
 *     REFUSES on symlinks is what keeps the absence check honest, so the
 *     idempotent case below is only reachable through a verified-contained
 *     parent)
 *   - leaf absent → satisfied post-condition (idempotent success — the safe
 *     retry after a persistence failure; nothing unlinked)
 *   - leaf is a symlink, directory, or other non-regular-file → refuse
 *     (file-only slice; deleting a symlink or recursing a directory is not
 *     what the human approved)
 *   - current content hashes to expectedPriorSha256 → actuate: unlink
 *   - any other hash → refuse: the file changed since approval, so the
 *     ratified approval no longer describes this file
 *
 * The content verification reads through an `O_RDONLY | O_NOFOLLOW` fd (leaf
 * cannot be swapped for a symlink between the lstat and the read), which is
 * closed BEFORE the unlink (Windows refuses to unlink an open file). The
 * hash-check→unlink gap is within the documented residual threat model
 * (an active local adversary inside the operator's own workspace); the same
 * boundary as every other op in this tier.
 *
 * Returns the detail string for the `ran` result. Throws (caught per-op) on
 * every refusal.
 */
function actuateDeleteFile(
  rootReal: string,
  parts: readonly string[],
  op: Extract<ExecutableOperation, { kind: "delete_file" }>,
): string {
  const dirParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1]!;
  const dirAbs = safeWalkExistingComponents(rootReal, dirParts);
  const realDir = realpathSync(dirAbs);
  if (!isInsideRoot(rootReal, realDir)) {
    throw new Error(
      "refusing to delete: parent resolves outside the workspace root (junction/reparse point)",
    );
  }
  const target = join(realDir, fileName);

  // Inspect the final component without following it.
  let existing: ReturnType<typeof lstatSync> | null;
  try {
    existing = lstatSync(target);
  } catch {
    existing = null;
  }
  if (existing === null) {
    // Absence IS the post-condition of a delete — idempotent success (retry
    // after a persistence failure, or an identical earlier run). Nothing done.
    return `${relative(rootReal, target)} (already absent; post-state satisfied, nothing deleted)`;
  }
  if (existing.isSymbolicLink()) {
    throw new Error("refusing to delete a symlink (file-only delete)");
  }
  if (!existing.isFile()) {
    throw new Error("target exists and is not a regular file (file-only delete; never recursive)");
  }

  // Verify the pinned pre-state through a no-follow fd, then close BEFORE the
  // unlink (Windows cannot unlink an open file).
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(target, flags);
  let currentHash: string;
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("target is not a regular file");
    }
    currentHash = sha256Hex(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }

  if (currentHash !== op.expectedPriorSha256) {
    throw new Error(
      "file content changed since approval (current content does not match the pinned " +
        "pre-state the delete was approved against; refusing to delete)",
    );
  }

  unlinkSync(target);
  return relative(rootReal, target);
}

/**
 * Resolve `parts` (a path already validated by `relSafeParts`) to its target
 * location via a must-exist walk of the PARENT chain plus a post-walk realpath
 * containment re-check on the parent. Returns the absolute target path and
 * the target's lstat (or null when nothing occupies the path). Shared shape
 * for ops that need "inspect the leaf without following it under a verified
 * parent" (rename source/destination).
 */
function resolveLeafUnderExistingParent(
  rootReal: string,
  parts: readonly string[],
  refusalContext: string,
): { readonly target: string; readonly st: NonNullable<ReturnType<typeof lstatSync>> | null } {
  const dirParts = parts.slice(0, -1);
  const leafName = parts[parts.length - 1]!;
  const dirAbs = safeWalkExistingComponents(rootReal, dirParts);
  const realDir = realpathSync(dirAbs);
  if (!isInsideRoot(rootReal, realDir)) {
    throw new Error(
      `refusing to ${refusalContext}: parent resolves outside the workspace root (junction/reparse point)`,
    );
  }
  const target = join(realDir, leafName);
  let st: NonNullable<ReturnType<typeof lstatSync>> | null;
  try {
    st = lstatSync(target) ?? null;
  } catch {
    st = null;
  }
  return { target, st };
}

/**
 * Actuate one rename_file op with the pinned-pre-state discipline (R1).
 *
 * Refusal semantics:
 *
 *   - either parent chain missing / symlinked / escaping → refuse (must-exist
 *     walks on BOTH the source's and destination's parents; a rename never
 *     materializes directories nobody approved)
 *   - source absent AND destination present hashing to the pin → satisfied
 *     post-condition (idempotent success — the safe retry after a persistence
 *     failure; nothing moved)
 *   - source absent otherwise → refuse (nothing to rename, and the
 *     destination does not carry the approved content)
 *   - source is a symlink, directory, or other non-regular-file → refuse
 *     (file-only slice)
 *   - source content does not hash to expectedPriorSha256 → refuse: the file
 *     changed since approval, so the approval no longer describes it
 *   - ANYTHING occupying the destination (file, dir, symlink — even dangling)
 *     → refuse (no-clobber: overwriting content nobody approved is never a
 *     rename)
 *   - source content hashes to the pin AND destination free → actuate:
 *     renameSync
 *
 * The source content verification reads through an `O_RDONLY | O_NOFOLLOW`
 * fd, which is closed BEFORE the rename (Windows refuses to rename an open
 * file). The hash-check→rename gap is within the documented residual threat
 * model (an active local adversary inside the operator's own workspace) — the
 * same boundary as every other op in this tier.
 *
 * Returns the detail string for the `ran` result. Throws (caught per-op) on
 * every refusal.
 */
function actuateRenameFile(
  rootReal: string,
  fromParts: readonly string[],
  toParts: readonly string[],
  op: Extract<ExecutableOperation, { kind: "rename_file" }>,
): string {
  const src = resolveLeafUnderExistingParent(rootReal, fromParts, "rename from");
  const dst = resolveLeafUnderExistingParent(rootReal, toParts, "rename to");

  if (src.st === null) {
    // Source gone. The ONLY honest success is the idempotent-satisfied case:
    // the destination already holds a regular file with the pinned content
    // (a retry after a persistence failure, or an identical earlier run).
    if (dst.st !== null && !dst.st.isSymbolicLink() && dst.st.isFile()) {
      const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
      const fd = openSync(dst.target, flags);
      let destHash: string;
      try {
        if (!fstatSync(fd).isFile()) {
          throw new Error("destination is not a regular file");
        }
        destHash = sha256Hex(readFileSync(fd, "utf8"));
      } finally {
        closeSync(fd);
      }
      if (destHash === op.expectedPriorSha256) {
        return `${relative(rootReal, dst.target)} (post-state already satisfied; nothing moved)`;
      }
      throw new Error(
        "source is absent and the destination content does not match the pinned pre-state " +
          "(refusing: the approved rename cannot be verified as already done)",
      );
    }
    throw new Error("source file does not exist (rename requires an existing source)");
  }
  if (src.st.isSymbolicLink()) {
    throw new Error("refusing to rename a symlink (file-only rename)");
  }
  if (!src.st.isFile()) {
    throw new Error("source exists and is not a regular file (file-only rename; never a directory)");
  }

  // No-clobber: anything at the destination is a refusal — the human approved
  // a move into empty space, never an overwrite. lstat above (dst.st) already
  // saw symlinks without following them.
  if (dst.st !== null) {
    throw new Error(
      "destination already exists (no-clobber: refusing to overwrite content nobody approved)",
    );
  }

  // Verify the pinned pre-state through a no-follow fd, then close BEFORE the
  // rename (Windows cannot rename an open file).
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(src.target, flags);
  let currentHash: string;
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error("source is not a regular file");
    }
    currentHash = sha256Hex(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
  if (currentHash !== op.expectedPriorSha256) {
    throw new Error(
      "file content changed since approval (current source content does not match the pinned " +
        "pre-state the rename was approved against; refusing to rename)",
    );
  }

  renameSync(src.target, dst.target);
  return `${relative(rootReal, src.target)} -> ${relative(rootReal, dst.target)}`;
}

/**
 * Create a sandboxed deterministic filesystem executor bound to `workspaceRoot`.
 *
 * The root MUST exist (it is realpath'd once at execution time). If it does not,
 * every op is reported failed rather than creating it — the operator names a real
 * sandbox; the executor never invents one.
 *
 * Returns a `DeterministicExecutor` suitable for `makeExecutionPort(executor)`.
 */
export function makeSandboxedFsExecutor(workspaceRoot: string): (ops: readonly ExecutableOperation[]) => ExecutorOutcome {
  const rootResolved = resolve(workspaceRoot);

  return (approvedOps: readonly ExecutableOperation[]) => {
    const ranOps: ExecutableOperation[] = [];
    const results: ExecutionOpResult[] = [];

    // Realpath the root once. If it does not exist, fail every op honestly.
    let rootReal: string;
    try {
      rootReal = realpathSync(rootResolved);
    } catch {
      for (const op of approvedOps) {
        results.push({
          op: { ...op },
          status: "failed",
          detail: `workspace root does not exist: ${rootResolved}`,
        });
      }
      return { ranOps, results, deterministic: false };
    }

    for (const op of approvedOps) {
      try {
        const parts = relSafeParts(op.path);
        if (op.kind === "create_dir") {
          const target = safeMkdirpComponents(rootReal, parts);
          ranOps.push({ ...op });
          results.push({ op: { ...op }, status: "ran", detail: relative(rootReal, target) });
        } else if (op.kind === "create_file") {
          const dirParts = parts.slice(0, -1);
          const fileName = parts[parts.length - 1]!;
          const dirAbs = safeMkdirpComponents(rootReal, dirParts);
          // TOCTOU defense: the parent could be swapped to a symlink/junction
          // AFTER the mkdirp walk returned. Re-resolve the parent's REAL path
          // immediately before deriving the target and confirm it is still
          // inside the root, then anchor the write to that canonical parent.
          const realDir = realpathSync(dirAbs);
          if (!isInsideRoot(rootReal, realDir)) {
            throw new Error(
              "refusing to write: parent resolves outside the workspace root (junction/reparse point)",
            );
          }
          const target = join(realDir, fileName);
          // Inspect the final component without following it (lstat).
          let existing: ReturnType<typeof lstatSync> | null;
          try {
            existing = lstatSync(target);
          } catch {
            existing = null;
          }
          if (existing === null) {
            // O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW: the kernel itself refuses to
            // create through a symlink at the final component (closing the race
            // window between the lstat above and the write) and fails closed if
            // the leaf was created by someone else in the meantime.
            exclusiveNoFollowWrite(target, op.content);
            // Residual-TOCTOU containment: `openSync` re-walks the full path, so
            // an INTERMEDIATE directory swapped to a symlink/junction between the
            // parent realpath check and the open could place the file outside the
            // root. Node has no portable openat(), so we verify the created file's
            // REAL location and revert if it escaped. We resolve ONCE and unlink
            // the resolved canonical location first (then the logical path) so a
            // further component swap after the check cannot redirect the unlink.
            let realTarget: string | null;
            try {
              realTarget = realpathSync(target);
            } catch {
              realTarget = null; // cannot prove containment → treat as escape
            }
            if (realTarget === null || !isInsideRoot(rootReal, realTarget)) {
              for (const victim of realTarget !== null ? [realTarget, target] : [target]) {
                try {
                  unlinkSync(victim);
                } catch {
                  /* best-effort revert; the op is still reported failed below */
                }
              }
              throw new Error(
                "refusing: target could not be proven inside the workspace root after create (intermediate reparse)",
              );
            }
          } else if (existing.isSymbolicLink()) {
            throw new Error("refusing to write through an existing symlink");
          } else if (!existing.isFile()) {
            throw new Error("target exists and is not a regular file");
          } else if (readFileSync(target, "utf8") !== op.content) {
            throw new Error("file exists with different content (refusing to overwrite)");
          }
          // else: identical content already present → idempotent success.
          ranOps.push({ ...op });
          results.push({ op: { ...op }, status: "ran", detail: relative(rootReal, target) });
        } else if (op.kind === "replace_in_file") {
          const detail = actuateReplaceInFile(rootReal, parts, op);
          ranOps.push({ ...op });
          results.push({ op: { ...op }, status: "ran", detail });
        } else if (op.kind === "delete_file") {
          const detail = actuateDeleteFile(rootReal, parts, op);
          ranOps.push({ ...op });
          results.push({ op: { ...op }, status: "ran", detail });
        } else if (op.kind === "rename_file") {
          // BOTH paths pass the lexical gate (`parts` above already validated
          // op.path — the source); the destination is validated here.
          const toParts = relSafeParts(op.toPath);
          const detail = actuateRenameFile(rootReal, parts, toParts, op);
          ranOps.push({ ...op });
          results.push({ op: { ...op }, status: "ran", detail });
        } else {
          // Defense-in-depth: the type system already constrains the union, but a
          // future op kind must be explicitly allowlisted here before it actuates.
          throw new Error("operation not in executor allowlist");
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        results.push({ op: { ...op }, status: "failed", detail });
      }
    }

    // Real IO is never deterministic in the kernel's strict sense.
    return { ranOps, results, deterministic: false };
  };
}
