/**
 * CP.S4 — candidate-plan evidence (CP-8, USESTEADY_CANDIDATE_PLAN_CONTRACT_V2).
 *
 * Every generation — including every fail-closed path — writes exactly one
 * CONTENT-FREE evidence line: hashes, counts, the model runtime string and
 * the outcome. Never the ratified text, never task text (task text is a
 * model draft of operator intent — same privacy posture as memory zests).
 *
 * Zero authority, best-effort: a sink failure never blocks or delays
 * generation. With no sink configured, gate behavior is byte-identical
 * (CP-5 discipline, mirroring the MEM.S4 evidence ledger).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type CandidatePlanEvidenceOutcome =
  | "candidate"
  | "no_adapter"
  | "anchor_mismatch"
  | "adapter_failure"
  | "no_valid_tasks";

export type CandidatePlanEvidenceEvent = {
  readonly kind: "candidate_plan_generation";
  readonly workItemId: string;
  readonly ratifiedTextSha256: string;
  readonly baselinePlanHash: string;
  readonly modelRuntime: string | null;
  readonly outcome: CandidatePlanEvidenceOutcome;
  readonly acceptedTaskCount: number;
  readonly violationCount: number;
};

/** One evidence line as persisted (event + ISO timestamp). */
export type CandidatePlanEvidenceLine = CandidatePlanEvidenceEvent & {
  readonly ts: string;
};

/** Zero-authority observer. Implementations must never throw upward. */
export type CandidatePlanEvidenceSink = (
  event: CandidatePlanEvidenceEvent,
) => void;

/** JSONL file sink — append-only, best-effort (failures swallowed). */
export function fileCandidatePlanEvidenceSink(
  path: string,
): CandidatePlanEvidenceSink {
  return (event) => {
    try {
      // The store dir may not exist yet (e.g. a fresh container where the
      // memory layer uses a remote backend). Best-effort, like the append.
      mkdirSync(dirname(path), { recursive: true });
      const line =
        JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
      appendFileSync(path, line, "utf8");
    } catch {
      // Evidence is best-effort: never propagate into the gate.
    }
  };
}

/** Read the ledger, optionally filtered by work item. Corrupt lines are
 *  skipped (never fabricated). Missing file = empty ledger. */
export function readCandidatePlanEvidence(
  path: string,
  workItemId?: string,
): readonly CandidatePlanEvidenceLine[] {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines: CandidatePlanEvidenceLine[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as CandidatePlanEvidenceLine;
      if (typeof parsed.ts !== "string" || typeof parsed.kind !== "string") {
        continue;
      }
      if (workItemId !== undefined && parsed.workItemId !== workItemId) {
        continue;
      }
      lines.push(parsed);
    } catch {
      continue;
    }
  }
  return lines;
}
