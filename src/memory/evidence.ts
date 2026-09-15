/**
 * MEM.S4 — memory evidence ledger (USESTEADY_MEMORY_CONTRACT_V0).
 *
 * Ratification events become first-class evidence: every human act that the
 * write gate performs (ratify / pointer move / privacy delete), including
 * fail-closed paths, emits exactly one append-only evidence line.
 *
 * Evidence Engine discipline, applied at the understanding layer:
 *   - The ledger is written AT THE GATE (where the human act happens), not
 *     by the adapter — it never trusts the storage path's self-report.
 *   - Lines are CONTENT-FREE: ids, hash anchors and timestamps only, never
 *     the zest text. The MEM-5 privacy deletion removes content; the
 *     evidence line remains valid because it never carried content. Proof
 *     outlives content.
 *   - Zero authority, best-effort: a sink failure never blocks or delays a
 *     memory write (DRL writer discipline). With no sink configured, gate
 *     behavior is byte-identical (MEM-10).
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

export type MemoryEvidenceEvent =
  | {
      readonly kind: "ratified";
      readonly workItemId: string;
      readonly memoryPointId: string;
      readonly ratifiedTextSha256: string;
      readonly ratificationEventRef: string;
      readonly ratifiedVersion: number;
      readonly supersedes: string | null;
    }
  | {
      readonly kind: "pointer_moved";
      readonly operatorId: string;
      readonly workItemId: string;
      readonly memoryPointId: string;
    }
  | {
      readonly kind: "deleted";
      readonly operatorId: string;
      readonly deletedMemoryPointId: string;
      readonly deletionEventId: string;
    }
  | {
      readonly kind: "write_unavailable";
      readonly workItemId: string;
      readonly reason: string;
    };

/** One evidence line as persisted (event + ISO timestamp). */
export type MemoryEvidenceLine = MemoryEvidenceEvent & { readonly ts: string };

/** Zero-authority observer. Implementations must never throw upward. */
export type MemoryEvidenceSink = (event: MemoryEvidenceEvent) => void;

/** JSONL file sink — append-only, best-effort (failures swallowed). */
export function fileMemoryEvidenceSink(path: string): MemoryEvidenceSink {
  return (event) => {
    try {
      const line =
        JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
      appendFileSync(path, line, "utf8");
    } catch {
      // Evidence is best-effort: never propagate into the write gate.
    }
  };
}

/** Read the ledger, optionally filtered by work item. Corrupt lines are
 *  skipped (never fabricated). Missing file = empty ledger. */
export function readMemoryEvidence(
  path: string,
  workItemId?: string,
): readonly MemoryEvidenceLine[] {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines: MemoryEvidenceLine[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as MemoryEvidenceLine;
      if (typeof parsed.ts !== "string" || typeof parsed.kind !== "string") {
        continue;
      }
      if (
        workItemId !== undefined &&
        (parsed as { workItemId?: string }).workItemId !== workItemId
      ) {
        continue;
      }
      lines.push(parsed);
    } catch {
      continue;
    }
  }
  return lines;
}
