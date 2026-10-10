/**
 * Deterministic ledger entry identity — no timestamps in hash (INV-LEDGER-4 / INV-LRUNTIME-4).
 *
 * Preimage (positional array, JSON.stringify):
 *   [ handler_intent_id, execution_id, capability_id, actor_id, prior_ledger_entry_id ?? "" ]
 * Each field trimmed; id strings preserve case (same rule as handler intent id).
 */

import { createHash } from "node:crypto";

export function ledgerEntryId(input: {
  readonly handler_intent_id: string;
  readonly execution_id: string;
  readonly capability_id: string;
  readonly actor_id: string;
  readonly prior_ledger_entry_id?: string;
}): string {
  const preimage = [
    input.handler_intent_id.trim(),
    input.execution_id.trim(),
    input.capability_id.trim(),
    input.actor_id.trim(),
    (input.prior_ledger_entry_id ?? "").trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
