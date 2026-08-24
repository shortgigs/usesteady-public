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
import type { RealityProbe } from "./observation.js";
/**
 * Create a read-only filesystem reality probe bound to `workspaceRoot`.
 *
 * Returns a {@link RealityProbe} suitable for `makeObservationPort(probe)`. It
 * reads `execution.results` to learn WHICH ops were claimed `ran`, then checks
 * each against the real filesystem. It never trusts the result's own success
 * flag — the claim is the assertion the probe tries to falsify.
 */
export declare function makeFsRealityProbe(workspaceRoot: string): RealityProbe;
//# sourceMappingURL=fs-reality-probe.d.ts.map