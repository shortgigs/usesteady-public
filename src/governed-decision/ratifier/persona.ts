/**
 * Persona ratifier provider — S1 (SYNTHETIC_OPERATOR_LANE_V1).
 *
 * The ratifier contract has ONE shape ({@link HumanRatification}) and two
 * providers (INV-SO-1). This module is the ONLY sanctioned constructor of the
 * persona seat:
 *
 *   provider: persona:<id>   — build lane only, zero authority
 *   provider: H (human)      — production, sole authority (existing surfaces)
 *
 * The swap between them is CONFIGURATION, never a code change: a persona
 * ratification flows through byte-for-byte the same kernel path
 * (`makeRatificationPort` → fingerprint anchoring → fail-closed execution
 * gate) that H flows through in production.
 *
 * ── What this module enforces ─────────────────────────────────────────────────
 *
 *   INV-SO-2 — the constructed input always carries `approverKind: "persona"`
 *   and an approver inside the reserved `persona:` namespace. The ratification
 *   stage independently refuses any input where the two disagree, so there is
 *   no construction path (here or elsewhere) that seats a persona as human.
 *
 *   INV-SO-3 — {@link syntheticRatifierEnabled} is the single environment gate
 *   surfaces consult before accepting a persona seat. It reads the SERVER /
 *   process environment only (same pattern as GOVERNED_EXECUTE): a client or
 *   request body can never turn it on. Surfaces that find a persona seat while
 *   the gate is off must BLOCK the decision — not degrade, not warn.
 *
 * ── What this module is NOT ───────────────────────────────────────────────────
 *
 *   Not a decision-maker. The persona's verdict (approve / reject) is an input
 *   supplied by the build lane (a script, a corpus driver, or an Interaction
 *   Harness invocation — D1 territory). This module only seats the verdict
 *   with honest provenance. It contains no LLM and never fabricates a decision.
 */

import { PERSONA_APPROVER_PREFIX } from "../types.js";
import type { RatificationDecision } from "../types.js";
import type { HumanRatification } from "../stages/ratification.js";

/** Environment flag that permits persona seats on a surface (INV-SO-3). */
export const SYNTHETIC_RATIFIER_ENV = "GOVERNED_SYNTHETIC_RATIFIER";

/**
 * Is the synthetic (persona) ratifier permitted in THIS process environment?
 *
 * Build-lane surfaces set `GOVERNED_SYNTHETIC_RATIFIER=1`. Production surfaces
 * never do; on them every persona seat is blocked, fail-closed. The gate is
 * read from the process environment only — never from request or CLI-user
 * input — so it is an operator/server decision, exactly like GOVERNED_EXECUTE.
 */
export function syntheticRatifierEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[SYNTHETIC_RATIFIER_ENV] === "1";
}

/** Input to {@link makePersonaRatification}. */
export type PersonaRatificationInput = {
  /** Persona identity, e.g. "skeptic-1". Non-empty, no whitespace, no colon. */
  readonly personaId: string;
  /** The persona's verdict — supplied by the build lane, never invented here. */
  readonly decision: RatificationDecision;
  /** The constitution stampFingerprint being ratified — anchoring unchanged. */
  readonly ratifiedFingerprint: string;
  /** Optional explicit timestamp (for determinism in tests); defaults to now. */
  readonly at?: string;
};

/**
 * Construct a persona-seated ratification input.
 *
 * Returns the one-shape ratifier contract input with honest synthetic
 * provenance: `approver: "persona:<id>"`, `approverKind: "persona"`.
 * Everything downstream (fingerprint anchoring, single-ratification,
 * fail-closed execution gate) treats it exactly like a human decision in
 * PIPELINE POSITION — while the typed provenance keeps it forever
 * distinguishable in the record (INV-SO-2).
 *
 * Throws on a malformed personaId: a persona that cannot be identified must
 * not be seated at all (fail-closed beats a fabricated identity).
 */
export function makePersonaRatification(input: PersonaRatificationInput): HumanRatification {
  const personaId = input.personaId.trim();
  if (personaId.length === 0 || /[\s:]/.test(personaId)) {
    throw new Error(
      `invalid personaId ${JSON.stringify(input.personaId)}: must be non-empty with no whitespace or ':'`,
    );
  }
  return {
    decision: input.decision,
    approver: `${PERSONA_APPROVER_PREFIX}${personaId}`,
    approverKind: "persona",
    ratifiedFingerprint: input.ratifiedFingerprint,
    ...(input.at !== undefined ? { at: input.at } : {}),
  };
}
