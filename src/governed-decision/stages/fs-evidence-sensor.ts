/**
 * Filesystem pre-state evidence sensor — L3.S1 (Lane 3, Certify slice).
 *
 * The Decision Basis evidence sub-section's first REAL sensor. For every
 * executable operation the understanding carries, it reads — read-only — what
 * actually exists at that target path in the bound workspace BEFORE the human
 * ratifies. This is genuine decision evidence: "does the thing this decision
 * would create already exist, and in what state?"
 *
 * ── Position in the spine ─────────────────────────────────────────────────────
 *
 *   The Decision Basis stage runs BEFORE ratification and execution in the
 *   canonical stage order, so what this sensor reports is always pre-state:
 *   the state of reality the human is deciding against, never the outcome.
 *   Post-state verification belongs to the INDEPENDENT reality probe
 *   (fs-reality-probe.ts) after execution.
 *
 * ── Independence discipline (same doctrine as the reality probe) ──────────────
 *
 *   This sensor deliberately re-implements its own path resolution and disk
 *   reads instead of importing the executor's helpers. A sensor that shares
 *   code with the actuator inherits the actuator's blind spots. It also does
 *   NOT import from src/evidence/ — the authority path stays structurally
 *   blind to the evidence observer (verify-rules Rule 13).
 *
 * ── Honesty / gauge law ───────────────────────────────────────────────────────
 *
 *   Every target produces a FACT, never a guess:
 *     - absent            → nothing exists at the path.
 *     - exists            → something exists; its kind (dir/file/symlink/other)
 *                           is reported, and for an approved create_file the
 *                           sensor states whether the existing content is
 *                           byte-identical to the approved content.
 *     - unsenseable       → the path is unsafe (escapes the root) or unreadable;
 *                           the verbatim reason is recorded. Stated, not skipped.
 *   The sensor throws only when the workspace root itself does not exist —
 *   there is no honest per-target fact to state about a root that is not
 *   there. The caller (decision-basis stage) degrades evidence to
 *   `unavailable` with that reason.
 *
 *   READ-ONLY: this module never creates, writes, deletes, or mutates.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ExecutableOperation } from "../types.js";

/** One sensed pre-state fact about a single operation's target path. */
export type PreStateTarget = {
  /** The operation's path, verbatim. */
  readonly path: string;
  /** The operation kind the path belongs to. */
  readonly opKind: ExecutableOperation["kind"];
  /** What the sensor found. */
  readonly preState: "absent" | "exists" | "unsenseable";
  /** Present only when preState is "exists": what occupies the path. */
  readonly existingKind?: "directory" | "file" | "symlink" | "other";
  /**
   * Present only when the target exists as a regular file AND the op carries
   * approved content to compare against:
   *   - create_file      → whether the existing content is byte-identical to
   *                        the approved content (an idempotent-satisfied
   *                        pre-condition vs a conflicting file).
   *   - replace_in_file  → whether the existing content still hashes to the
   *                        pinned pre-state (`expectedPriorSha256`) the
   *                        approval anchors to — false means the file changed
   *                        after the pin was sensed, and the executor would
   *                        refuse (L4.S1).
   *   - delete_file      → whether the existing content still hashes to the
   *                        pinned pre-state the delete was approved against —
   *                        false means the file changed after the pin was
   *                        sensed, and the executor would refuse (A1).
   *   - rename_file      → whether the SOURCE file's existing content still
   *                        hashes to the pinned pre-state the rename was
   *                        approved against — false means the file changed
   *                        after the pin was sensed, and the executor would
   *                        refuse (R1).
   */
  readonly contentMatchesApproved?: boolean;
  /** Present only when preState is "unsenseable": the verbatim reason. */
  readonly detail?: string;
};

/** The connected evidence value the decision-basis stage records. */
export type PreStateEvidence = {
  readonly source: "workspace pre-state sensor";
  /** The resolved real workspace root the targets were sensed under. */
  readonly workspaceRoot: string;
  readonly targets: readonly PreStateTarget[];
};

/**
 * Resolve a relative op path into safe components, refusing any path that
 * escapes the workspace root. Mirrors the executor's/probe's normalization
 * semantics (interior non-escaping `..` normalizes, e.g. `a/../utils` ->
 * `utils`) so the sensor reads the SAME location the executor would actuate —
 * re-implemented, not imported (independence discipline).
 */
function safeParts(p: string): readonly string[] {
  if (typeof p !== "string" || p.trim().length === 0) {
    throw new Error("empty path");
  }
  if (isAbsolute(p)) {
    throw new Error("absolute path");
  }
  const target = resolve("/__usesteady_evidence_root__", p);
  const rel = relative("/__usesteady_evidence_root__", target);
  if (rel === "") {
    throw new Error("path resolves to the workspace root itself");
  }
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("path escapes the workspace root");
  }
  const parts = rel.split(sep).filter((seg) => seg.length > 0);
  if (parts.length === 0) {
    throw new Error("path resolves to the workspace root itself");
  }
  return parts;
}

/** True when `p` (already realpath'd) is the workspace root or strictly inside it. */
function isInsideRoot(rootReal: string, p: string): boolean {
  if (p === rootReal) return true;
  const rel = relative(rootReal, p);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

/** Sense one target's pre-state. Never throws; refusals become unsenseable facts. */
function senseTarget(rootReal: string, op: ExecutableOperation): PreStateTarget {
  let parts: readonly string[];
  try {
    parts = safeParts(op.path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: op.path, opKind: op.kind, preState: "unsenseable", detail: `unsafe path (${message})` };
  }
  const target = join(rootReal, ...parts);

  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(target);
  } catch {
    // Nothing occupies the path — a real, sensed absence.
    return { path: op.path, opKind: op.kind, preState: "absent" };
  }

  const existingKind: PreStateTarget["existingKind"] = st.isSymbolicLink()
    ? "symlink"
    : st.isDirectory()
      ? "directory"
      : st.isFile()
        ? "file"
        : "other";

  // Containment on what EXISTS: if the occupied path's real location escapes
  // the root (junction/reparse), the sensor cannot honestly describe it as
  // workspace pre-state.
  if (existingKind !== "symlink") {
    try {
      const real = realpathSync(target);
      if (!isInsideRoot(rootReal, real)) {
        return {
          path: op.path,
          opKind: op.kind,
          preState: "unsenseable",
          detail: "existing path resolves outside the workspace root",
        };
      }
    } catch {
      return {
        path: op.path,
        opKind: op.kind,
        preState: "unsenseable",
        detail: "existing path could not be resolved",
      };
    }
  }

  // For an approved create_file over an existing regular file, state whether
  // the existing content already satisfies the approved content (byte-identical).
  // For a pinned replace_in_file (L4.S1), delete_file (A1), or rename_file (R1
  // — `op.path` is the source), state whether the existing content still
  // hashes to the pinned pre-state the approval anchors to.
  if (
    (op.kind === "create_file" ||
      op.kind === "replace_in_file" ||
      op.kind === "delete_file" ||
      op.kind === "rename_file") &&
    existingKind === "file"
  ) {
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch {
      return {
        path: op.path,
        opKind: op.kind,
        preState: "unsenseable",
        detail: "existing file could not be read",
      };
    }
    const contentMatchesApproved =
      op.kind === "create_file"
        ? content === op.content
        : // replace_in_file, delete_file, and rename_file all anchor to
          // expectedPriorSha256.
          createHash("sha256").update(content, "utf8").digest("hex") === op.expectedPriorSha256;
    return { path: op.path, opKind: op.kind, preState: "exists", existingKind, contentMatchesApproved };
  }

  return { path: op.path, opKind: op.kind, preState: "exists", existingKind };
}

/**
 * Sense the pre-state of every operation target under `workspaceRoot`.
 *
 * Throws ONLY when the workspace root does not exist (the caller degrades the
 * evidence sub-section to `unavailable` with the verbatim reason). Every other
 * condition becomes a per-target fact — the sensor states, it never skips.
 */
export function senseWorkspacePreState(
  workspaceRoot: string,
  ops: readonly ExecutableOperation[],
): PreStateEvidence {
  const rootResolved = resolve(workspaceRoot);
  let rootReal: string;
  try {
    rootReal = realpathSync(rootResolved);
  } catch {
    throw new Error(`workspace root does not exist: ${rootResolved}`);
  }

  return {
    source: "workspace pre-state sensor",
    workspaceRoot: rootReal,
    targets: ops.map((op) => senseTarget(rootReal, op)),
  };
}
