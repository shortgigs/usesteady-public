/**
 * Human Ratification stage — spine port v1.
 *
 * ── Authority model (non-negotiable) ──────────────────────────────────────────
 *
 *   "Humans ratify." — USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md, Section 2.
 *
 *   The ratification section is the governed-decision record's proof that a real
 *   human made a real decision. It is therefore implemented as a FACTORY, not as
 *   a static adapter: the human decision is an INPUT captured at construction
 *   time, never fabricated inside the port. A port that invented an approval
 *   would violate the sole authority.
 *
 *   With no human decision (`makeRatificationPort(null)`), the port honestly
 *   returns `unavailable` — the sole authority has not acted, and the spine's
 *   fail-closed gate keeps execution blocked.
 *
 * ── Fingerprint anchoring — why it exists ─────────────────────────────────────
 *
 *   The constitution stamp stage (constitution.ts) computes a SHA-256 fingerprint
 *   over the exact inputs available at stamp time (humanIntent + understanding).
 *   That fingerprint is the "identity" of the specific stamped decision.
 *
 *   A ratification is only meaningful when it is tied to the decision the human
 *   ACTUALLY reviewed. Without anchoring, a recorded approval from a prior run
 *   could be silently replayed against a different decision — a false proof of
 *   human authority. The fingerprint check enforces:
 *
 *     human.ratifiedFingerprint === ctx.prior.constitution.value.stampFingerprint
 *
 *   If the fingerprints differ (stale approval, replayed approval, or approval
 *   for a different intent), the port returns `unavailable` and execution stays
 *   blocked. There is no partial-match or version-tolerance path.
 *
 * ── Double binding: fingerprint + recordId ────────────────────────────────────
 *
 *   The pipeline additionally computes a `recordId` as a SHA-256 hash over ALL
 *   sections of the GovernedDecisionRecord, including both the constitution
 *   section (which carries the stampFingerprint) and the ratification section
 *   (which records decision + approver + at). The recordId therefore transitively
 *   binds the ratification to the specific stamped decision: you cannot detach
 *   the approval from the fingerprinted inputs without changing the recordId.
 *
 * ── All decisions faithfully recorded ────────────────────────────────────────
 *
 *   A matching fingerprint produces a `connected` section regardless of the
 *   decision value (approved / rejected / changes_requested). The section is a
 *   faithful record of what the human actually decided. Whether execution runs is
 *   NOT decided by this stage — the spine's fail-closed gate in pipeline.ts
 *   allows execution only when `decision === "approved"`. A "rejected" or
 *   "changes_requested" ratification is a connected, honest record; the gate
 *   blocks execution by itself.
 *
 * ── Gauge law ──────────────────────────────────────────────────────────────────
 *
 *   "connected"   → a real human decision is anchored to the stamped fingerprint.
 *   "unavailable" → one of: no human decision, no stamped constitution, or
 *                   fingerprint mismatch. Reason is explicit in each case.
 *   "derived"     → not used here; the decision is an external human input,
 *                   never derived from internal computation.
 *
 * ── Never throws ───────────────────────────────────────────────────────────────
 *
 *   Unexpected errors are caught and degrade the section to unavailable so the
 *   spine is never thrown into.
 */

import { PERSONA_APPROVER_PREFIX } from "../types.js";
import type {
  ApproverKind,
  DecisionSection,
  RatificationDecision,
  RatificationPayload,
} from "../types.js";
import type { BaseStageContext } from "../pipeline.js";

// The ratifier contract has ONE shape and two providers (INV-SO-1): a human
// seat and a persona seat. The persona provider MUST identify itself inside
// the reserved namespace (PERSONA_APPROVER_PREFIX in types.ts), and the
// namespace is refused to human seats. The port below enforces agreement
// between the namespace and `approverKind` in BOTH directions, so no
// construction path can present a persona ratification as human or vice
// versa (INV-SO-2 — no casting path).

// ─── Local input type ──────────────────────────────────────────────────────────

/**
 * The ratifier's decision — the single input shape of the ratifier contract
 * (INV-SO-1: one contract, two providers; the swap is configuration).
 *
 * This is an INPUT, not an output. The port factory captures it at construction
 * time and records it faithfully. The port never generates or modifies it.
 *
 * `ratifiedFingerprint` is the constitution `stampFingerprint` the ratifier is
 * approving. The port verifies this matches the actual stamp in `ctx.prior`
 * before accepting the ratification — this is the anchoring enforcement.
 */
export type HumanRatification = {
  readonly decision: RatificationDecision;
  readonly approver: string;
  /**
   * Which kind of seat is deciding (INV-SO-2). Absent means "human" — the
   * shape every pre-S1 human surface (TTY CLI, server-bound approver)
   * constructs. Persona providers MUST set "persona" AND identify inside the
   * `persona:` approver namespace; the port fails closed on any disagreement,
   * so omitting the field is never a path to seating a persona as human.
   */
  readonly approverKind?: ApproverKind;
  /** The constitution stampFingerprint the ratifier is approving — anchors the decision. */
  readonly ratifiedFingerprint: string;
  /** Optional explicit timestamp (for determinism in tests); defaults to now. */
  readonly at?: string;
};

// ─── factory ──────────────────────────────────────────────────────────────────

/**
 * Create a ratification port from a human decision (or `null` if no decision
 * has been made yet).
 *
 * Why a factory?
 *   The port signature required by `StagePorts` is a function of `ctx` only.
 *   The human decision must enter from outside (it is an external authority
 *   input, not computable from `ctx`). A factory is the correct pattern:
 *   it captures the decision at construction time and closes over it. This is
 *   the only way to separate "what the human decided" (external, real-world)
 *   from "what the pipeline can see" (ctx) without fabricating anything.
 *
 * Port behavior:
 *
 *   1. `human === null`
 *      → unavailable: the sole authority has not acted. The spine keeps
 *        execution blocked until a real decision is supplied.
 *
 *   2. `human` supplied, but `ctx.prior.constitution` is absent or not "connected"
 *      → unavailable: there is no fingerprinted stamp to anchor the decision to.
 *        Ratifying without a stamp would be ratifying nothing in particular.
 *
 *   3. `human.ratifiedFingerprint` does NOT match `constitution.value.stampFingerprint`
 *      → unavailable: the fingerprints differ — the approval is stale, replayed,
 *        or was issued for a different decision. Fail closed.
 *
 *   4. fingerprints match
 *      → connected: the human decision is faithfully recorded. The spine's own
 *        fail-closed gate (pipeline.ts) then gates execution on `decision === "approved"`.
 */
export function makeRatificationPort(
  human: HumanRatification | null,
): (ctx: BaseStageContext) => Promise<DecisionSection<RatificationPayload>> {
  return async (ctx: BaseStageContext): Promise<DecisionSection<RatificationPayload>> => {
    try {
      // ── Guard 1: sole authority has not acted ────────────────────────────────
      if (human === null) {
        return {
          status: "unavailable",
          reason: "awaiting human ratification; no decision supplied",
        };
      }

      // ── Guard 2: no stamped constitution to anchor to ──────────────────────
      const constitution = ctx.prior.constitution;
      if (constitution === undefined || constitution.status !== "connected") {
        return {
          status: "unavailable",
          reason: "cannot ratify: no connected constitution stamp to anchor the decision to",
        };
      }

      // ── Guard 3: fingerprint anchoring — block stale / replayed approvals ──
      const expectedFingerprint = constitution.value.stampFingerprint;
      if (human.ratifiedFingerprint !== expectedFingerprint) {
        return {
          status: "unavailable",
          reason:
            "ratification rejected: approved fingerprint does not match the stamped decision (stale or mismatched ratification)",
        };
      }

      // ── Guard 4: seat provenance agreement (INV-SO-2 — no casting path) ─────
      // The persona approver namespace and the typed seat kind must agree in
      // BOTH directions. A persona-namespaced approver claiming (or defaulting
      // to) the human kind is a provenance spoof; a persona kind outside the
      // namespace hides the synthetic seat from every string surface. Either
      // disagreement fails closed — the decision is refused, never reclassified.
      const approverKind: ApproverKind = human.approverKind ?? "human";
      const inPersonaNamespace = human.approver.startsWith(PERSONA_APPROVER_PREFIX);
      if (inPersonaNamespace !== (approverKind === "persona")) {
        return {
          status: "unavailable",
          reason:
            "ratification rejected: approver namespace and approverKind disagree (a persona seat must be 'persona:<id>' with approverKind 'persona'; the namespace is reserved)",
        };
      }

      // ── Connected: faithfully record the real ratifier decision ────────────
      const value: RatificationPayload = {
        decision: human.decision,
        approver: human.approver,
        approverKind,
        at: human.at ?? new Date().toISOString(),
      };

      return { status: "connected", value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        reason: `ratification stage failed unexpectedly: ${message}`,
      };
    }
  };
}

// ─── default export ────────────────────────────────────────────────────────────

/**
 * The honest default: no human decision supplied → execution stays blocked.
 *
 * This is the port to use when building the spine before the human has acted.
 * Pass it as `ports.ratification` for an "awaiting decision" run — ratification
 * will be `unavailable`, and the spine's fail-closed gate will block execution.
 *
 * When a human decision arrives, replace this with
 * `makeRatificationPort(humanDecision)` and re-run the spine (two-pass flow).
 */
export const ratificationPort = makeRatificationPort(null);
