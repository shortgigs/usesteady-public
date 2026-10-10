/**
 * Replace-pin sensor — L4.S1 (Lane 4, Actuation breadth).
 *
 * The read-only sensor that anchors a governed update/replace to the reality
 * the human actually saw. For a goal the deterministic parser classifies as a
 * `replace` intent, it reads the target file's CURRENT content under the same
 * containment discipline as the other kernel sensors and produces a
 * {@link FileReplacePin}: the sha256 of that content (the pre-state the
 * approval anchors to) plus the sha256 of the deterministically-derived
 * post-content (every `find` occurrence replaced).
 *
 * ── Why the pin is injected data, not sensed inside understanding ─────────────
 *
 *   The understanding port is a pure function of (goal, constraints, injected
 *   data) — that purity is what makes the constitution fingerprint reproducible
 *   between a draft and its final. So the pin follows the candidate-plan seam
 *   pattern exactly:
 *
 *     decide time → the surface calls senseReplacePin() against the SAME
 *                   workspace the executor would actuate, and injects the pin.
 *                   The op the human reviews carries the pinned hashes.
 *     ratify time → the surface calls replacePinFromRecord() on the reviewed
 *                   draft and injects THAT pin verbatim — never re-sensed. The
 *                   final reproduces the identical understanding, so the
 *                   ratification anchors to exactly what the human saw.
 *     execute time → the executor re-reads the real file and refuses when its
 *                   current hash matches neither pinned hash: reality changed
 *                   since approval, so the approval no longer describes it.
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
 *   senseReplacePin returns null — never a fabricated pin — when:
 *     - the goal does not parse as a replace intent,
 *     - the target path is unsafe (absolute / escapes the workspace root),
 *     - nothing exists at the path, or what exists is not a regular file
 *       (symlink/dir/other), or its real location escapes the root,
 *     - the file cannot be read,
 *     - `find` does not occur in the content (nothing to replace — an op would
 *       be a dishonest no-op), or `find` equals the replacement (no change).
 *   A null pin means the understanding carries no executable operation for the
 *   replace intent — exactly the pre-L4.S1 behavior. READ-ONLY: this module
 *   never creates, writes, deletes, or mutates. Never throws.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { normalizeIntent } from "../../understand/interpretation/intent.js";
import type { ExecutableOperation, GovernedDecisionRecord } from "../types.js";

/**
 * The sensed pin a surface injects into the understanding port. Plain data —
 * carries no authority and no file content, only the path it was sensed for
 * and the two content-addressed anchors.
 */
export type FileReplacePin = {
  /** The target path the pin was sensed for, verbatim from the parsed intent. */
  readonly path: string;
  /** sha256 (hex) of the file content at sense time — the approval's pre-state anchor. */
  readonly expectedPriorSha256: string;
  /** sha256 (hex) of the derived post-content (every `find` occurrence replaced). */
  readonly expectedPostSha256: string;
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
  const target = resolve("/__usesteady_pin_root__", p);
  const rel = relative("/__usesteady_pin_root__", target);
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
 * Sense the replace pin for `goal` against `workspaceRoot`.
 *
 * Returns a {@link FileReplacePin} only when the goal is a parser-classified
 * replace intent whose target is a real, contained, readable regular file that
 * actually contains `find` (and the replacement would change it). Every other
 * condition returns null — no pin is ever fabricated.
 */
export function senseReplacePin(workspaceRoot: string, goal: string): FileReplacePin | null {
  try {
    const parsed = normalizeIntent(goal);
    if (parsed === null || parsed.kind !== "replace") return null;
    if (parsed.find === parsed.replace) return null;

    const parts = safeParts(parsed.file);
    if (parts === null) return null;

    let rootReal: string;
    try {
      rootReal = realpathSync(resolve(workspaceRoot));
    } catch {
      return null;
    }

    const target = join(rootReal, ...parts);

    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(target);
    } catch {
      return null; // nothing exists at the path
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;

    // Containment on what exists: the real location must stay inside the root
    // (catches intermediate junctions/reparse points lstat does not flag).
    try {
      const real = realpathSync(target);
      if (!isInsideRoot(rootReal, real)) return null;
    } catch {
      return null;
    }

    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch {
      return null;
    }
    if (!content.includes(parsed.find)) return null;

    const post = content.split(parsed.find).join(parsed.replace);
    return {
      path: parsed.file,
      expectedPriorSha256: sha256Hex(content),
      expectedPostSha256: sha256Hex(post),
    };
  } catch {
    return null;
  }
}

/**
 * Reconstruct the replace pin from a STORED record's understanding section, or
 * null when the record carries no `replace_in_file` operation.
 *
 * Used by ratification surfaces so `produceFinal` reproduces EXACTLY the
 * pinned op the human reviewed — the pin is read verbatim from the reviewed
 * draft, never re-sensed. A file that changed between decide and ratify is
 * therefore caught by the EXECUTOR's hash gate (an honest per-op refusal in
 * the record), not by silently re-anchoring the approval to new content.
 */
export function replacePinFromRecord(
  record: Pick<GovernedDecisionRecord, "understanding"> | { readonly understanding?: unknown },
): FileReplacePin | null {
  const section = (record as { understanding?: unknown }).understanding as
    | { status?: unknown; value?: { candidatePlans?: unknown } }
    | undefined;
  if (section === undefined || section.status !== "connected") return null;
  const plans = section.value?.candidatePlans;
  if (!Array.isArray(plans)) return null;

  for (const p of plans) {
    const op = (p as { operation?: ExecutableOperation }).operation;
    if (op !== undefined && op.kind === "replace_in_file") {
      return {
        path: op.path,
        expectedPriorSha256: op.expectedPriorSha256,
        expectedPostSha256: op.expectedPostSha256,
      };
    }
  }
  return null;
}
