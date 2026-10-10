/**
 * Filesystem RealityProbe — Tier 1.2a. The kernel's first INDEPENDENT reality
 * sensor: it re-derives what actually exists on disk and compares it to what the
 * executor CLAIMED it did. This is "Reality has the final veto" made literal.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 *   Tier 1.1b made execution real, but Observation still trusted the executor's
 *   self-report (or, with the reference probe, fabricated "agree"). A self-report
 *   is not verification: an executor could claim `ran` for an op that never landed
 *   (a bug, a race, a tampered disk). The kernel's promise — "the core certifies;
 *   reality has the final veto" — requires an INDEPENDENT check against reality.
 *
 * ── Independence is the design (do not "DRY" this with the executor) ───────────
 *
 *   This probe deliberately re-implements its own path resolution and disk reads
 *   instead of importing the executor's helpers. A verifier that shares code with
 *   the thing it verifies inherits that thing's blind spots: a containment bug in
 *   the executor would be mirrored by the probe and the disagreement would never
 *   surface. The probe is a SECOND, independent implementation on purpose.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *
 *   For every op the executor CLAIMED it `ran` (read from `execution.results`),
 *   the probe independently checks the real filesystem under `workspaceRoot`:
 *     - create_dir      → a real directory exists at that path (not a symlink),
 *                         and its realpath stays inside the workspace root.
 *     - create_file     → a real file exists with BYTE-IDENTICAL content, not a
 *                         symlink, realpath inside the root.
 *     - replace_in_file → a real file exists whose content hashes EXACTLY to the
 *                         op's expectedPostSha256 (the deterministically-derived
 *                         post-state pinned at draft time) — byte-exact
 *                         verification via content addressing (L4.S1).
 *     - delete_file     → NOTHING exists at that path (A1). The post-condition
 *                         of a delete is absence; anything still occupying the
 *                         path — file, directory, symlink — contradicts the
 *                         claim. Absence is checked with lstat (not stat), so
 *                         a dangling symlink left at the path is correctly
 *                         seen as "something still there".
 *     - rename_file     → the SOURCE path is absent AND the DESTINATION holds
 *                         a real file whose content hashes EXACTLY to the op's
 *                         expectedPriorSha256 (R1 — a rename moves content
 *                         unchanged, so the pinned pre-state IS the expected
 *                         post-state at the destination). Both halves must
 *                         hold; a lingering source or a wrong/missing
 *                         destination contradicts the claim.
 *   It treats each `ran` claim as a FALSIFIABLE assertion. Any absent/mismatched/
 *   escaped claim makes the whole verdict `disagree` (reality vetoes the claim).
 *
 * ── Honesty / gauge law ───────────────────────────────────────────────────────
 *
 *   - `agree`    → every claimed-`ran` op was verified present-and-correct.
 *   - `disagree` → at least one claimed-`ran` op is absent, wrong, or escaped;
 *                  OR the workspace root itself does not exist.
 *   - `unknown`  → there is nothing to verify (no `ran` ops in the report). The
 *                  probe never fabricates agreement over an empty check.
 *   The probe is READ-ONLY: it never creates, writes, deletes, or mutates. It is
 *   an observer, never an actor.
 *
 *   Downstream, `makeObservationPort` sets `feedsNextCycle = true` only on
 *   `match + agree`, so a reality-contradicted OR reality-unverified outcome
 *   cannot pollute the next cycle's basis.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecutableOperation, ExecutionPayload, ScopeObservation } from "../types.js";
import type { RealityProbeResult } from "./observation.js";
import {
  authorizedDeltaPaths,
  classifyCollateral,
  diffScopeSnapshots,
  snapshotFsScope,
} from "./scope-snapshot.js";

/**
 * Resolve a relative op path into safe components, refusing any path that escapes
 * the workspace root.
 *
 * IMPORTANT — resolution semantics MUST match the executor (it normalizes a
 * non-escaping interior `..`, e.g. `a/../utils` -> `utils`, and actuates it). If
 * the probe rejected interior `..` outright, it would check the WRONG location
 * for a legitimately-actuated op and report a FALSE `disagree`. So this mirrors
 * the executor's `resolve()`/`relative()` normalization — re-implemented, not
 * imported. This is deliberate: matching WHERE-it-lands is required for
 * correctness; the INDEPENDENT reality check is the realpath containment in
 * `verifyOp`, which is what must not share code with the executor.
 *
 * Throws (caught per-op) on absolute paths, the root-itself path, or a path that
 * normalizes to an escape.
 */
function safeParts(p: string): readonly string[] {
  if (typeof p !== "string" || p.trim().length === 0) {
    throw new Error("empty path");
  }
  if (isAbsolute(p)) {
    throw new Error("absolute path");
  }
  const target = resolve("/__usesteady_probe_root__", p);
  const rel = relative("/__usesteady_probe_root__", target);
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

type Verification = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/** Independently verify a single claimed-ran op against the real filesystem. */
function verifyOp(rootReal: string, op: ExecutableOperation): Verification {
  let parts: readonly string[];
  try {
    parts = safeParts(op.path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `${op.path}: unsafe path (${message})` };
  }
  const target = join(rootReal, ...parts);

  // A rename claim is verified in two halves (R1): the source must be ABSENT
  // and the destination must hold a real, contained file whose content hashes
  // to the pinned pre-state. Handled before the generic exists-and-contained
  // checks below because `op.path` (the source) is verified by absence.
  if (op.kind === "rename_file") {
    let srcStill: ReturnType<typeof lstatSync> | null;
    try {
      srcStill = lstatSync(target);
    } catch {
      srcStill = null; // source gone — half the claim holds
    }
    if (srcStill !== null) {
      return {
        ok: false,
        detail: `${op.path}: claimed renamed away but something still exists at the source`,
      };
    }

    let toParts: readonly string[];
    try {
      toParts = safeParts(op.toPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: `${op.toPath}: unsafe destination path (${message})` };
    }
    const dest = join(rootReal, ...toParts);

    let dst: ReturnType<typeof lstatSync>;
    try {
      dst = lstatSync(dest);
    } catch {
      return { ok: false, detail: `${op.toPath}: claimed rename destination is absent on disk` };
    }
    if (dst.isSymbolicLink() || !dst.isFile()) {
      return { ok: false, detail: `${op.toPath}: destination exists but is not a regular file` };
    }
    let destReal: string;
    try {
      destReal = realpathSync(dest);
    } catch {
      return { ok: false, detail: `${op.toPath}: could not resolve destination real path` };
    }
    if (!isInsideRoot(rootReal, destReal)) {
      return { ok: false, detail: `${op.toPath}: destination resolves outside the workspace root` };
    }
    let destContent: string;
    try {
      destContent = readFileSync(dest, "utf8");
    } catch {
      return { ok: false, detail: `${op.toPath}: destination could not be read` };
    }
    // A rename moves content unchanged, so the pinned pre-state hash IS the
    // expected post-state at the destination — byte-exact via content
    // addressing, independently re-derived.
    const destHash = createHash("sha256").update(destContent, "utf8").digest("hex");
    if (destHash !== op.expectedPriorSha256) {
      return {
        ok: false,
        detail: `${op.toPath}: destination content does not hash to the approved pre-state`,
      };
    }
    return { ok: true };
  }

  // A delete claim is verified by ABSENCE — inverted relative to every other
  // op kind, so it is handled before the exists-and-contained checks below.
  if (op.kind === "delete_file") {
    let still: ReturnType<typeof lstatSync> | null;
    try {
      still = lstatSync(target);
    } catch {
      still = null; // nothing occupies the path — the claimed delete is real
    }
    if (still !== null) {
      const kind = still.isSymbolicLink()
        ? "a symlink"
        : still.isDirectory()
          ? "a directory"
          : still.isFile()
            ? "a file"
            : "something";
      return { ok: false, detail: `${op.path}: claimed deleted but ${kind} still exists on disk` };
    }
    return { ok: true };
  }

  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(target);
  } catch {
    return { ok: false, detail: `${op.path}: absent on disk` };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, detail: `${op.path}: is a symlink, not a real ${op.kind === "create_dir" ? "directory" : "file"}` };
  }

  // Containment: the real path of what exists must stay inside the root. Catches a
  // claimed op whose path resolves (via an intermediate junction/reparse) outside.
  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    return { ok: false, detail: `${op.path}: could not resolve real path` };
  }
  if (!isInsideRoot(rootReal, real)) {
    return { ok: false, detail: `${op.path}: resolves outside the workspace root` };
  }

  if (op.kind === "create_dir") {
    if (!st.isDirectory()) {
      return { ok: false, detail: `${op.path}: exists but is not a directory` };
    }
    return { ok: true };
  }
  if (op.kind === "create_file") {
    if (!st.isFile()) {
      return { ok: false, detail: `${op.path}: exists but is not a regular file` };
    }
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch {
      return { ok: false, detail: `${op.path}: could not be read` };
    }
    if (content !== op.content) {
      return { ok: false, detail: `${op.path}: content differs from the approved operation` };
    }
    return { ok: true };
  }
  if (op.kind === "replace_in_file") {
    if (!st.isFile()) {
      return { ok: false, detail: `${op.path}: exists but is not a regular file` };
    }
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch {
      return { ok: false, detail: `${op.path}: could not be read` };
    }
    // Independent re-derivation: the on-disk content must hash EXACTLY to the
    // post-state pinned on the approved op. Content addressing gives the same
    // byte-exact strength as the create_file comparison without the probe
    // needing the (unpinned) file body.
    const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
    if (actualHash !== op.expectedPostSha256) {
      return {
        ok: false,
        detail: `${op.path}: content does not hash to the approved post-state`,
      };
    }
    return { ok: true };
  }
  // Defense-in-depth: the union is exhaustive, but an unknown kind is unverifiable.
  return { ok: false, detail: `${op.path}: unknown operation kind` };
}

/**
 * Create a read-only filesystem reality probe bound to `workspaceRoot`.
 *
 * Returns a {@link RealityProbe} suitable for `makeObservationPort(probe)`. It
 * reads `execution.results` to learn WHICH ops were claimed `ran`, then checks
 * each against the real filesystem. It never trusts the result's own success
 * flag — the claim is the assertion the probe tries to falsify.
 */
export function makeFsRealityProbe(workspaceRoot: string): (execution: ExecutionPayload) => RealityProbeResult {
  const rootResolved = resolve(workspaceRoot);

  return (execution: ExecutionPayload): RealityProbeResult => {
    const results = execution.results ?? [];
    const claimedRan: readonly ExecutableOperation[] = results
      .filter((r) => r.status === "ran")
      .map((r) => r.op);

    // ── Collateral closure (Collateral Mutation Closure V1) ─────────────────
    // When the execution section carries a DECLARED observation scope and its
    // pre-actuation snapshot (captured before the executor ran), independently
    // re-snapshot the SAME declared scope — the scope is read verbatim from the
    // record, never re-derived or substituted here — and reconcile: any delta
    // outside the authorized op targets is an unauthorized mutation and turns
    // the verdict to `disagree` (the approved execution and the actual
    // execution disagree). Runs even when nothing was claimed `ran`: an
    // executor that reports no actuation but mutated the scope is still
    // contradicted by reality.
    let scopeObservation: ScopeObservation | undefined;
    let collateralMismatch: string | null = null;
    if (execution.observationScope !== undefined && execution.scopeSnapshotPre !== undefined) {
      const scope = execution.observationScope;
      let post: ReturnType<typeof snapshotFsScope>;
      try {
        post = snapshotFsScope(rootResolved, scope);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          realityVerdict: "disagree",
          detail: `could not complete the independent scope readback: ${message}`,
          ...(scopeObservation !== undefined ? { scopeObservation } : {}),
        };
      }
      // The authorized delta is re-derived by a PURE function from the recorded
      // approved ops (every op in `results`, ran or failed — an op the executor
      // omitted from its own report was already caught by ranWhatWasApproved).
      const authorized = authorizedDeltaPaths(results.map((r) => r.op));
      const collateral = classifyCollateral(
        diffScopeSnapshots(execution.scopeSnapshotPre, post),
        authorized,
      );
      scopeObservation = {
        scope,
        snapshotPost: post,
        unauthorizedAdditions: collateral.additions,
        unauthorizedModifications: collateral.modifications,
        unauthorizedDeletions: collateral.deletions,
      };
      const findings: string[] = [];
      if (collateral.additions.length > 0) {
        findings.push(`unauthorized addition(s): ${collateral.additions.join(", ")}`);
      }
      if (collateral.modifications.length > 0) {
        findings.push(`unauthorized modification(s): ${collateral.modifications.join(", ")}`);
      }
      if (collateral.deletions.length > 0) {
        findings.push(`unauthorized deletion(s): ${collateral.deletions.join(", ")}`);
      }
      if (findings.length > 0) {
        collateralMismatch = `unauthorized change(s) inside the declared observation scope [${scope.join(", ")}]: ${findings.join("; ")}`;
      }
    }

    if (claimedRan.length === 0) {
      if (collateralMismatch !== null) {
        return {
          realityVerdict: "disagree",
          detail: collateralMismatch,
          ...(scopeObservation !== undefined ? { scopeObservation } : {}),
        };
      }
      return {
        realityVerdict: "unknown",
        detail: "no actuated operations were reported, so there is nothing to verify on disk",
        ...(scopeObservation !== undefined ? { scopeObservation } : {}),
      };
    }

    let rootReal: string;
    try {
      rootReal = realpathSync(rootResolved);
    } catch {
      return {
        realityVerdict: "disagree",
        detail: `workspace root does not exist: ${rootResolved}`,
        ...(scopeObservation !== undefined ? { scopeObservation } : {}),
      };
    }

    const mismatches: string[] = [];
    for (const op of claimedRan) {
      const check = verifyOp(rootReal, op);
      if (!check.ok) {
        mismatches.push(check.detail);
      }
    }

    if (collateralMismatch !== null) mismatches.push(collateralMismatch);

    if (mismatches.length > 0) {
      return {
        realityVerdict: "disagree",
        detail: `reality contradicts ${mismatches.length} claim(s): ${mismatches.join("; ")}`,
        ...(scopeObservation !== undefined ? { scopeObservation } : {}),
      };
    }

    return {
      realityVerdict: "agree",
      detail:
        `independently verified ${claimedRan.length} actuated op(s) present and correct on disk` +
        (scopeObservation !== undefined
          ? `; no unauthorized change inside the declared observation scope [${scopeObservation.scope.join(", ")}]`
          : ""),
      ...(scopeObservation !== undefined ? { scopeObservation } : {}),
    };
  };
}
