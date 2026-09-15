/**
 * Constitution stamp stage — spine port v1.
 *
 * Stamps the governed decision with the kernel's frozen constitutional
 * invariants and a deterministic fingerprint over the inputs it can see at
 * this position in the pipeline.
 *
 * ── Ordering constraint and stamp honesty ──────────────────────────────────────
 *
 *   The canonical STAGE_ORDER (types.ts) runs constitution AFTER understanding
 *   and BEFORE decisionBasis. At the moment this port executes, the Decision
 *   Basis has NOT been computed yet — `ctx.prior.decisionBasis` is undefined.
 *
 *   Therefore the stamp CAN ONLY bind what already exists in the accumulator:
 *     • ctx.humanIntent     — the raw human intent (goal + constraints)
 *     • ctx.prior.understanding — the understanding section (if connected)
 *
 *   The stamp does NOT bind the Decision Basis; to do so would be to claim
 *   binding over data that does not yet exist — a false stamp.
 *
 *   A later Phase C slice may add a post-basis re-stamp once all upstream
 *   sections are available. This v1 stamp is the "pre-basis constitutional
 *   checkmark": it certifies the intent was understood within the frozen
 *   invariants, before the basis phase expands the record further.
 *
 * ── Applied invariants — only genuinely enforced ones are listed ──────────────
 *
 *   See INVARIANT_CODE_LOCATIONS below for the exact code location that enforces
 *   each invariant. Do NOT add an invariant that is aspirational or unenforced.
 *
 * ── Gauge law ──────────────────────────────────────────────────────────────────
 *
 *   "connected"  → understanding is connected; stamp binds a real section.
 *   "unavailable"→ understanding is missing or unavailable; nothing honest to stamp.
 *   "derived"    → not used here.
 *
 * ── Never throws ───────────────────────────────────────────────────────────────
 *
 *   Unexpected errors are caught and degrade the section to unavailable.
 */

import { createHash } from "node:crypto";

import type { DecisionSection, ConstitutionPayload } from "../types.js";
import type { BaseStageContext } from "../pipeline.js";

// ─── Constitutional invariants ─────────────────────────────────────────────────

/**
 * Mapping: invariant identifier → the exact code location that enforces it.
 *
 * This comment is the single source of truth for the enforcement locations.
 * Update it whenever an enforcing location moves.
 *
 *   gauge-law
 *     Enforcement: src/governed-decision/types.ts, `DecisionSection<T>` type.
 *     The discriminated union { status: "connected" | "derived" | "unavailable" }
 *     makes "invented" literally unrepresentable at compile time. A value field
 *     is present if and only if status is "connected" or "derived".
 *
 *   loop-guardrail
 *     Enforcement: src/governed-decision/pipeline.ts, `BasisStageContext` type
 *     and `runGovernedDecisionSpine()` dispatch.
 *     `priorObservation` is a field only on `BasisStageContext`, not on
 *     `BaseStageContext`. Only the `decisionBasis` port receives a
 *     `BasisStageContext`; all other ports receive `BaseStageContext` and
 *     structurally cannot see the prior observation. Observation therefore
 *     cannot reach ratification or execution by construction.
 *
 *   fail-closed-execution
 *     Enforcement: src/governed-decision/pipeline.ts, `runGovernedDecisionSpine()`,
 *     the `ratificationApproved` gate (~line 145-155).
 *     The execution port is invoked if and only if ratification is present AND
 *     `decision === "approved"`. In every other path the execution section is
 *     set to `unavailable` with an explicit reason. The execution port has no
 *     bypass path.
 */
const APPLIED_INVARIANTS: readonly string[] = [
  "gauge-law: every section is connected/derived/unavailable; invented is unrepresentable",
  "loop-guardrail: prior observation feeds Decision Basis only, never authority or execution",
  "fail-closed-execution: nothing runs without human ratification approved",
];

// ─── stamp computation ─────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 fingerprint over the inputs this stamp binds.
 *
 * Bound inputs (all that precede the constitution stage in STAGE_ORDER):
 *   1. humanIntent  — the raw goal and constraints supplied by the human.
 *   2. understanding — the gauge-tagged understanding section from the prior stage.
 *
 * NOT bound (not yet computed at this stage):
 *   - decisionBasis, truthArbitration, ratification, execution, observation.
 *
 * Canonicalization: explicit ordered object with fixed keys, serialized with
 * JSON.stringify. This is deterministic for the plain-object payloads used here
 * (no Maps, Sets, or non-serializable values). The key order is fixed in the
 * source so the digest is stable across JS engine implementations.
 */
function computeStampFingerprint(ctx: BaseStageContext): string {
  const canonical = JSON.stringify({
    humanIntent: {
      goal: ctx.humanIntent.goal,
      constraints: ctx.humanIntent.constraints,
    },
    understanding: ctx.prior.understanding,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── public port ──────────────────────────────────────────────────────────────

/**
 * Run the constitution stamp stage and return a gauge-tagged
 * `DecisionSection<ConstitutionPayload>` for the governed-decision spine.
 *
 * Connected: the prior understanding section is connected — there is a real,
 *   classified intent to stamp. The fingerprint binds humanIntent + understanding.
 *
 * Unavailable: the understanding section is absent or unavailable. The
 *   constitution does not stamp a decision that has no understood intent;
 *   stamping an absent or failed understanding would misrepresent the record.
 *
 * Never throws. Unexpected errors are caught and degrade to unavailable.
 */
export async function buildConstitutionSection(
  ctx: BaseStageContext,
): Promise<DecisionSection<ConstitutionPayload>> {
  try {
    const understanding = ctx.prior.understanding;

    // Only stamp when there is a real, connected understanding to bind.
    // An absent or unavailable understanding means the intent was not safely
    // interpreted; there is nothing honest to certify at this point.
    if (understanding === undefined || understanding.status !== "connected") {
      return {
        status: "unavailable",
        reason: "cannot stamp: no connected understanding to bind",
      };
    }

    const stampFingerprint = computeStampFingerprint(ctx);

    const value: ConstitutionPayload = {
      // Copy so each record owns its invariant list; never share the module
      // constant reference across records (integrity hygiene).
      appliedInvariants: [...APPLIED_INVARIANTS],
      stampFingerprint,
    };

    return { status: "connected", value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      reason: `constitution stamp stage failed unexpectedly: ${message}`,
    };
  }
}

/**
 * Convenience alias so the adapter can be passed directly as
 * `ports.constitution` in a `runGovernedDecisionSpine()` call.
 */
export const constitutionPort = buildConstitutionSection;
