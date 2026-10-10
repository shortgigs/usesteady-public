import { appendFileSync } from "node:fs";

export type RuntimeLedgerOutcome =
  | "BLOCK"
  | "REVIEW_REQUIRED"
  | "EXECUTES_AFTER_APPROVAL";

export type RuntimeLedgerEvent = {
  prompt: string;
  outcome: RuntimeLedgerOutcome;
  reason: string;
  notes?: readonly string[];
};

/**
 * Runtime Decision Ledger (DRL) writer.
 *
 * Observability sink for the workflow coordinator. It records the disposition
 * of each task (BLOCK / REVIEW_REQUIRED / EXECUTES_AFTER_APPROVAL) as it moves
 * through the gate. It has ZERO authority: it never blocks, approves, or alters
 * an execution decision. It only observes.
 *
 * Persistence is opt-in and best-effort:
 *   - When USESTEADY_DRL_LEDGER_PATH is set, each event is appended as one JSON
 *     line (JSONL, with an ISO `ts`) to that file. The operator can inspect or
 *     post-process the file directly.
 *   - When unset (the default), the writer is a no-op. UseSteady is deterministic
 *     and fully functional without the ledger.
 *
 * Append failures are swallowed deliberately: the ledger must never throw,
 * block, or delay an execution decision.
 */
export function recordRuntimeLedgerEvent(event: RuntimeLedgerEvent): void {
  const target = process.env["USESTEADY_DRL_LEDGER_PATH"]?.trim();
  if (!target) return;

  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    appendFileSync(target, line, "utf8");
  } catch {
    // best-effort observability: never propagate a ledger write failure
  }
}
