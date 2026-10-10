/**
 * Elicitation gate -- a pure read-side outcome over a GovernedDecisionRecord.
 *
 * Charter: docs/architecture/USESTEADY_EXPLICIT_INVOCATION_LINEAGE_V1.md, S2.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 *
 *   Explicit Invocation Lineage says every invocation is independent and
 *   terminates. When a confident draft cannot be produced because the intent was
 *   not understood (or carries unresolved unknowns), the honest outcome is NOT a
 *   silent un-ratifiable draft -- it is "needs input": a closed invocation that
 *   states EXACTLY what is missing. The caller then RE-INVOKES with the answers as
 *   DECLARED INPUTS (a refined goal, constraints, or references) -- never as
 *   conversational memory (INV-EIL-1/2). There is no "continue where we left off".
 *
 *   Like projection.ts and epistemic.ts this is a PURE READ-SIDE classification:
 *   it adds NO pipeline stage, NO authority, changes NO record and NO content
 *   hash, and its only import is ./types.js. It reads the record and nothing else.
 *
 * ── Gauge law (INV-EIL-7) ──────────────────────────────────────────────────────
 *
 *   Every question is copied VERBATIM from the record -- the understanding stage's
 *   own unavailable `reason`, or its preserved `unknowns[]`. Nothing is fabricated.
 *   A fixed fallback instruction is used ONLY when the record carries no readable
 *   reason at all (mirroring projection.ts's "unavailable (no reason given)"); it
 *   is a surface instruction, not invented record data.
 *
 * ── Never throws ───────────────────────────────────────────────────────────────
 *
 *   Any malformed/partial/foreign record degrades to a safe outcome rather than
 *   throwing (read surfaces consume persisted records).
 */

import type { GovernedDecisionRecord } from "./types.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Why an invocation needs input before a confident draft can be ratified.
 *
 *   intent_not_understood -- the deterministic parser could not classify the goal
 *                            (understanding is `unavailable`). The record has no
 *                            stamped fingerprint, so it cannot be ratified as-is.
 *   unresolved_unknowns   -- understanding is connected but preserved first-class
 *                            unknowns block a confident draft (a future parser
 *                            capability; today understanding is fully-resolving).
 */
export type ElicitationBasis = "intent_not_understood" | "unresolved_unknowns";

export type ElicitationOutcome =
  | { readonly status: "ready" }
  | {
      readonly status: "needs_input";
      readonly basis: ElicitationBasis;
      /** Exactly what is missing, verbatim from the record. Never empty. */
      readonly questions: readonly string[];
    };

/** Surface instruction used only when the record carries no readable reason. */
const FALLBACK_QUESTION =
  "the intent could not be interpreted; re-invoke with a clearer goal as a declared input";

// ─── Defensive section reader (mirrors projection.ts / epistemic.ts) ────────────

function sectionStatus(section: unknown): "connected" | "derived" | "unavailable" | "other" {
  if (section === null || typeof section !== "object") return "other";
  const s = (section as { status?: unknown }).status;
  if (s === "connected" || s === "derived" || s === "unavailable") return s;
  return "other";
}

// ─── Public evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate the elicitation gate for a record.
 *
 *   "ready"       -- understanding is connected/derived with no unresolved
 *                    unknowns: a confident draft exists and may proceed to the
 *                    human ratification gate unchanged.
 *   "needs_input" -- the invocation should close and the caller should re-invoke
 *                    with the listed answers as DECLARED INPUTS. `questions` are
 *                    read verbatim from the record (gauge law).
 *
 * Pure: reads ONLY the record; invents nothing; never throws.
 */
export function evaluateElicitation(record: GovernedDecisionRecord): ElicitationOutcome {
  // Defensive: a null/non-object record cannot present a confident draft.
  if (record === null || typeof record !== "object") {
    return { status: "needs_input", basis: "intent_not_understood", questions: [FALLBACK_QUESTION] };
  }

  const understanding = record.understanding;
  const uStatus = sectionStatus(understanding);

  // Intent not understood: the parser returned null -> the section is unavailable
  // (or malformed). Surface the stage's OWN reason as the question (verbatim);
  // fall back to a fixed instruction only when no readable reason exists.
  if (uStatus !== "connected" && uStatus !== "derived") {
    const reason = (understanding as { reason?: unknown }).reason;
    const question =
      typeof reason === "string" && reason.length > 0 ? reason : FALLBACK_QUESTION;
    return { status: "needs_input", basis: "intent_not_understood", questions: [question] };
  }

  // Understanding is connected/derived: a confident draft is blocked ONLY by
  // preserved first-class unknowns. Read them verbatim; empty -> ready.
  const value = (understanding as { value?: unknown }).value;
  const unknownsRaw =
    value !== null && typeof value === "object"
      ? (value as { unknowns?: unknown }).unknowns
      : undefined;
  const unknowns = Array.isArray(unknownsRaw)
    ? unknownsRaw.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : [];

  if (unknowns.length > 0) {
    return { status: "needs_input", basis: "unresolved_unknowns", questions: unknowns };
  }

  return { status: "ready" };
}
