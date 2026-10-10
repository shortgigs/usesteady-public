/**
 * USESTEADY_OPENALEX_OBSERVER_BOUNDARY_VALIDATION_V1 — evidence observer sink.
 *
 * Modeled exactly on src/observe/drl-ledger-writer.ts (the zero-authority
 * precedent). It records an EvidenceObservation to a SEPARATE append-only JSONL
 * file, distinct from the constitution approvals store.
 *
 * Properties (all inherited from the DRL pattern):
 *   - Opt-in: writes only when USESTEADY_EVIDENCE_LEDGER_PATH is set; a no-op by
 *     default (the removal property — UseSteady is byte-identical without it).
 *   - Append-only JSONL with an ISO `ts`.
 *   - Best-effort: write failures are swallowed; the sink must never throw,
 *     block, or delay anything.
 *   - Zero authority: nothing in the gate / eligibility / approval / execution
 *     path reads this file (enforced by verify-rules Rule 12/13).
 *
 * This module imports NO Constitution surface. It cannot touch the Decision
 * Basis or the fingerprint.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

import type { EvidenceObservation } from "./types.js";

/** Environment variable that opts the evidence sink in. Unset = no-op. */
export const EVIDENCE_LEDGER_PATH_ENV = "USESTEADY_EVIDENCE_LEDGER_PATH";

/**
 * Append one evidence observation to the opt-in ledger.
 *
 * No-op when the ledger path is unset. Never throws.
 */
export function recordEvidenceObservation(observation: EvidenceObservation): void {
  const target = process.env[EVIDENCE_LEDGER_PATH_ENV]?.trim();
  if (!target) return;

  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...observation }) + "\n";
    appendFileSync(target, line, "utf8");
  } catch {
    // best-effort observability: never propagate an evidence-ledger write failure
  }
}

/**
 * Read back every observation in append order. Used by the boundary cert to
 * confirm a write happened; never read by any decision path.
 */
export function loadEvidenceObservations(path: string): readonly EvidenceObservation[] {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceObservation);
}
