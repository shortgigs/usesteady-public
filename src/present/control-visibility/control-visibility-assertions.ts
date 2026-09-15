/**
 * Control Visibility Assertions — Phase 5B.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   A HARD GUARD layer. Not optional. Not stylistic.
 *
 *   Throws immediately on any ControlVisibilityResult that violates the
 *   authority invariants. Catches invalid states before they reach rendering.
 *
 * ── Locked rules (permanent — see docs/cvg-baseline.md) ─────────────────────
 *
 *   C2 — CVG may assert, but never route.
 *        This function throws or returns void. It never changes the caller's output.
 *
 *   C3 — CVG may detect violations, but never repair them silently.
 *        A bad result throws. It is never promoted, demoted, or patched here.
 *        Silent repair is worse than the violation it hides.
 *
 * ── What this guards ──────────────────────────────────────────────────────────
 *
 *   1. Blocking signal that does not disable confirm
 *      → system would allow execution on a blocked state
 *
 *   2. Blocking signal indistinguishable from normal
 *      → different authority levels collapse into same presentation
 *
 *   3. Ambiguous signal treated as confirmable
 *      → ambiguous state would allow execution without clarification
 *
 *   4. Refused signal missing surface requirement
 *      → a refused state could be silently hidden from H
 *
 *   5. ready_to_confirm treated as blocking
 *      → normal state incorrectly blocks execution
 *
 * ── What this does NOT do ─────────────────────────────────────────────────────
 *
 *   Does NOT fix invalid states   — it throws; the caller must not produce them
 *   Does NOT log or warn          — it throws immediately
 *   Does NOT affect valid results — returns void when all invariants hold
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   Call assertControlVisibilityConsistency(result) immediately after
 *   evaluateControlVisibility() in any presentation entry point.
 *   A throw here means the evaluator or upstream state produced an invalid result.
 */

import type { ControlVisibilityResult } from "./control-visibility-types.js";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assert that a ControlVisibilityResult satisfies all authority invariants.
 *
 * Throws a ControlVisibilityViolationError if any invariant is broken.
 * Returns void when all invariants hold.
 *
 * Call this immediately after evaluateControlVisibility() in every
 * presentation entry point. This is the runtime enforcement of the CVG contract.
 */
export function assertControlVisibilityConsistency(
  result: ControlVisibilityResult,
): void {
  // I1 — Blocking signal must disable confirm.
  if (result.level === "blocking" && !result.must_block_confirm) {
    throw new ControlVisibilityViolationError(
      result,
      "I1",
      `Blocking signal "${result.signal}" does not disable confirm. ` +
      `must_block_confirm must be true for all blocking signals.`,
    );
  }

  // I2 — Blocking signal must not be indistinguishable from normal.
  //      A blocking result with must_block_confirm=false and must_surface=false
  //      would be identical in flags to a normal result.
  if (
    result.level === "blocking" &&
    !result.must_surface &&
    !result.must_block_confirm
  ) {
    throw new ControlVisibilityViolationError(
      result,
      "I2",
      `Blocking signal "${result.signal}" is indistinguishable from normal. ` +
      `A blocking result must set must_block_confirm or must_surface (or both).`,
    );
  }

  // I3 — Ambiguous must not be confirmable.
  //      must_block_confirm=false would allow confirm on an ambiguous state.
  //      must_surface must be true (H must see it).
  if (result.signal === "ambiguous" && result.must_block_confirm) {
    throw new ControlVisibilityViolationError(
      result,
      "I3a",
      `Ambiguous signal has must_block_confirm=true, which is reserved for blocking. ` +
      `Ambiguous is "attention" level — it must surface but not hard-block.`,
    );
  }
  if (result.signal === "ambiguous" && !result.must_surface) {
    throw new ControlVisibilityViolationError(
      result,
      "I3b",
      `Ambiguous signal is not surfaced (must_surface=false). ` +
      `Ambiguous state must always be visible to H.`,
    );
  }

  // I4 — Refused states must have surface requirement.
  if (
    (result.signal === "refused_scope" || result.signal === "refused_execution") &&
    !result.must_surface
  ) {
    throw new ControlVisibilityViolationError(
      result,
      "I4",
      `Refused signal "${result.signal}" is missing surface requirement. ` +
      `All refused states must be surfaced to H.`,
    );
  }

  // I5 — ready_to_confirm must not be treated as blocking.
  if (result.signal === "ready_to_confirm" && result.must_block_confirm) {
    throw new ControlVisibilityViolationError(
      result,
      "I5",
      `"ready_to_confirm" signal has must_block_confirm=true. ` +
      `A ready state must never block confirm.`,
    );
  }

  // I6 — must_differentiate must always be true (no level may be invisible).
  if (!result.must_differentiate) {
    throw new ControlVisibilityViolationError(
      result,
      "I6",
      `Signal "${result.signal}" has must_differentiate=false. ` +
      `All control visibility results must be structurally distinct.`,
    );
  }

  // I7 — provisionally_executable must always surface (Phase 5D).
  if (result.signal === "provisionally_executable" && !result.must_surface) {
    throw new ControlVisibilityViolationError(
      result,
      "I7",
      `"provisionally_executable" signal has must_surface=false. ` +
      `A provisional execution warning must always be visible to H.`,
    );
  }

  // I8 — provisionally_executable must never be blocking (Phase 5D).
  //       It is attention-level: it informs, does not hard-block.
  if (result.signal === "provisionally_executable" && result.must_block_confirm) {
    throw new ControlVisibilityViolationError(
      result,
      "I8",
      `"provisionally_executable" signal has must_block_confirm=true. ` +
      `A provisional warning is attention-level and must not hard-block confirm.`,
    );
  }

  // I9 — provisionally_executable must be distinguishable from ready_to_confirm (Phase 5D).
  //       Both are non-blocking, but provisionally_executable must surface (attention)
  //       while ready_to_confirm does not need to (normal). The must_surface flag
  //       enforces the structural difference.
  if (
    result.signal === "provisionally_executable" &&
    result.level !== "attention"
  ) {
    throw new ControlVisibilityViolationError(
      result,
      "I9",
      `"provisionally_executable" signal has level="${result.level}" but must be "attention". ` +
      `It must remain structurally distinguishable from "ready_to_confirm" (normal).`,
    );
  }
}

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * ControlVisibilityViolationError — thrown when a CVG invariant is broken.
 *
 * Carries the violating result and the invariant code for traceability.
 */
export class ControlVisibilityViolationError extends Error {
  public readonly result:    ControlVisibilityResult;
  public readonly invariant: string;

  constructor(result: ControlVisibilityResult, invariant: string, message: string) {
    super(`[CVG ${invariant}] ${message}`);
    this.name      = "ControlVisibilityViolationError";
    this.result    = result;
    this.invariant = invariant;
  }
}
