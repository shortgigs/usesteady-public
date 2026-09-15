/**
 * Rename-pin sensor — R1 (Actuation breadth: governed file rename).
 *
 * The read-only sensor that anchors a governed RENAME to the reality the human
 * actually saw. For a goal the deterministic parser classifies as a `rename`
 * intent, it reads the SOURCE file's CURRENT content under the same
 * containment discipline as the other kernel sensors and produces a
 * {@link FileRenamePin}: the sha256 of that content — the pre-state the
 * approval anchors to. What the human approves is "rename THIS file with THIS
 * content to THAT path", never "rename whatever happens to be at this path by
 * the time the executor runs".
 *
 * ── Why the pin is injected data, not sensed inside understanding ─────────────
 *
 *   Identical seam to the replace pin (L4.S1) and the delete pin (A1): the
 *   understanding port is a pure function of (goal, constraints, injected
 *   data), which is what makes the constitution fingerprint reproducible
 *   between a draft and its final.
 *
 *     decide time → the surface calls senseRenamePin() against the SAME
 *                   workspace the executor would actuate, and injects the pin.
 *                   The op the human reviews carries the pinned hash.
 *     ratify time → the surface calls renamePinFromRecord() on the reviewed
 *                   draft and injects THAT pin verbatim — never re-sensed. The
 *                   final reproduces the identical understanding, so the
 *                   ratification anchors to exactly what the human saw.
 *     execute time → the executor re-reads the real source file and refuses
 *                   when its current hash does not match the pin: reality
 *                   changed since approval, so the approval no longer
 *                   describes it. Source absent + destination present hashing
 *                   to the pin is the satisfied post-condition.
 *
 * ── Independence discipline ───────────────────────────────────────────────────
 *
 *   Path resolution and disk reads are re-implemented here (same doctrine as
 *   the pre-state evidence sensor and the reality probe): a sensor that shares
 *   code with the actuator inherits the actuator's blind spots. No import from
 *   src/evidence/ (verify-rules Rule 13).
 *
 * ── Honesty / gauge law ───────────────────────────────────────────────────────
 *
 *   senseRenamePin returns null — never a fabricated pin — when:
 *     - the goal does not parse as a rename intent,
 *     - either path is unsafe (absolute / escapes the workspace root),
 *     - source and destination normalize to the same location (a no-op
 *       "rename" is a dishonest op),
 *     - nothing exists at the source path (renaming nothing is a dishonest
 *       no-op op),
 *     - what exists at the source is not a regular file (symlink/dir/other —
 *       directory rename is OUT of this slice),
 *     - the source's real location escapes the root, or it cannot be read,
 *     - the destination's PARENT chain is missing, contains a symlink, a
 *       non-directory, or escapes the root (the executor's must-exist walk
 *       would refuse, and it never materializes directories — a condition
 *       knowable at decide time must not produce a draft that can only fail),
 *     - ANYTHING already occupies the destination path (no-clobber: an op
 *       that would overwrite content nobody approved must never be drafted).
 *   A null pin means the understanding carries no executable operation for the
 *   rename intent — exactly the pre-R1 behavior. READ-ONLY: this module never
 *   creates, writes, deletes, renames, or mutates. Never throws.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { normalizeIntent } from "../../understand/interpretation/intent.js";
import type { ExecutableOperation, GovernedDecisionRecord } from "../types.js";

/**
 * The sensed pin a surface injects into the understanding port. Plain data —
 * carries no authority and no file content, only the paths it was sensed for
 * and the content-addressed pre-state anchor of the SOURCE file.
 */
export type FileRenamePin = {
  /** The source path the pin was sensed for, verbatim from the parsed intent. */
  readonly fromPath: string;
  /** The destination path, verbatim from the parsed intent. */
  readonly toPath: string;
  /** sha256 (hex) of the SOURCE file content at sense time — the approval's pre-state anchor. */
  readonly expectedPriorSha256: string;
};

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Resolve a relative path into safe components, refusing any path that escapes
 * the workspace root. Mirrors the executor's/probe's/evidence-sensor's
 * normalization semantics (interior non-escaping `..` normalizes) so the pin
 * is sensed at the SAME location the executor would actuate — re-implemented,
 * not imported (independence discipline).
 */
function safeParts(p: string): readonly string[] | null {
  if (typeof p !== "string" || p.trim().length === 0) return null;
  if (isAbsolute(p)) return null;
  const target = resolve("/__usesteady_rename_pin_root__", p);
  const rel = relative("/__usesteady_rename_pin_root__", target);
  if (rel === "") return null;
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return null;
  const parts = rel.split(sep).filter((seg) => seg.length > 0);
  return parts.length === 0 ? null : parts;
}

/** True when `p` (already realpath'd) is the workspace root or strictly inside it. */
function isInsideRoot(rootReal: string, p: string): boolean {
  if (p === rootReal) return true;
  const rel = relative(rootReal, p);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

/**
 * Sense the rename pin for `goal` against `workspaceRoot`.
 *
 * Returns a {@link FileRenamePin} only when the goal is a parser-classified
 * rename intent whose source is a real, contained, readable regular file and
 * whose destination is currently unoccupied (no-clobber). Every other
 * condition returns null — no pin is ever fabricated.
 */
export function senseRenamePin(workspaceRoot: string, goal: string): FileRenamePin | null {
  try {
    const parsed = normalizeIntent(goal);
    if (parsed === null || parsed.kind !== "rename") return null;

    const fromParts = safeParts(parsed.from);
    const toParts = safeParts(parsed.to);
    if (fromParts === null || toParts === null) return null;
    // A "rename" whose normalized source and destination coincide is a no-op —
    // drafting an op for it would be dishonest.
    if (fromParts.join(sep) === toParts.join(sep)) return null;

    let rootReal: string;
    try {
      rootReal = realpathSync(resolve(workspaceRoot));
    } catch {
      return null;
    }

    const source = join(rootReal, ...fromParts);
    const destination = join(rootReal, ...toParts);

    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(source);
    } catch {
      return null; // nothing exists at the source — no honest rename op
    }
    if (st.isSymbolicLink() || !st.isFile()) return null; // file-only slice

    // Containment on what exists: the real location must stay inside the root
    // (catches intermediate junctions/reparse points lstat does not flag).
    try {
      const real = realpathSync(source);
      if (!isInsideRoot(rootReal, real)) return null;
    } catch {
      return null;
    }

    // The destination's PARENT chain must already exist as real, contained
    // directories: the executor's must-exist walk refuses missing parents and
    // never materializes directories nobody approved, so an op drafted over a
    // missing parent could only ever fail at execute time. Refusing here keeps
    // the draft honest about what is executable. Symlinked or non-directory
    // components are refused for the same reason (executor parity, checked
    // per-component with lstat so a symlink is seen as a symlink).
    let parentCursor = rootReal;
    for (const part of toParts.slice(0, -1)) {
      const next = join(parentCursor, part);
      let pst: ReturnType<typeof lstatSync>;
      try {
        pst = lstatSync(next);
      } catch {
        return null; // parent component missing — the executor would refuse
      }
      if (pst.isSymbolicLink() || !pst.isDirectory()) return null;
      try {
        const realNext = realpathSync(next);
        if (!isInsideRoot(rootReal, realNext)) return null;
      } catch {
        return null;
      }
      parentCursor = next;
    }

    // No-clobber: anything already at the destination (file, dir, symlink —
    // even dangling) means the rename would overwrite or collide with content
    // nobody approved. lstat (not stat) so a dangling symlink is seen.
    try {
      lstatSync(destination);
      return null; // something occupies the destination
    } catch {
      /* destination is free — the only path that continues */
    }

    let content: string;
    try {
      content = readFileSync(source, "utf8");
    } catch {
      return null;
    }

    return {
      fromPath: parsed.from,
      toPath: parsed.to,
      expectedPriorSha256: sha256Hex(content),
    };
  } catch {
    return null;
  }
}

/**
 * Reconstruct the rename pin from a STORED record's understanding section, or
 * null when the record carries no `rename_file` operation.
 *
 * Used by ratification surfaces so `produceFinal` reproduces EXACTLY the
 * pinned op the human reviewed — the pin is read verbatim from the reviewed
 * draft, never re-sensed. A source file that changed between decide and
 * ratify is therefore caught by the EXECUTOR's hash gate (an honest per-op
 * refusal in the record), not by silently re-anchoring the approval.
 */
export function renamePinFromRecord(
  record: Pick<GovernedDecisionRecord, "understanding"> | { readonly understanding?: unknown },
): FileRenamePin | null {
  const section = (record as { understanding?: unknown }).understanding as
    | { status?: unknown; value?: { candidatePlans?: unknown } }
    | undefined;
  if (section === undefined || section.status !== "connected") return null;
  const plans = section.value?.candidatePlans;
  if (!Array.isArray(plans)) return null;

  for (const p of plans) {
    const op = (p as { operation?: ExecutableOperation }).operation;
    if (op !== undefined && op.kind === "rename_file") {
      return {
        fromPath: op.path,
        toPath: op.toPath,
        expectedPriorSha256: op.expectedPriorSha256,
      };
    }
  }
  return null;
}
