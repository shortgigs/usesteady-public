/**
 * Deterministic background job identity — no timestamps in hash (INV-BJOB-3).
 *
 * Preimage (positional array, JSON.stringify):
 *   [ job_kind, execution_id, ledger_entry_id, store_sequence ]
 */

import { createHash } from "node:crypto";

import type { BackgroundJobKind } from "./types.js";
import type { PersistedLedgerEntry } from "../persistence/types.js";

export function backgroundJobId(input: {
  readonly job_kind: BackgroundJobKind;
  readonly execution_id: string;
  readonly ledger_entry_id: string;
  readonly store_sequence: number;
}): string {
  const preimage = [
    input.job_kind.trim(),
    input.execution_id.trim(),
    input.ledger_entry_id.trim(),
    String(input.store_sequence),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}

/** Fingerprint of persisted ledger bytes for transport dedupe (descriptive only). */
export function persistedEntryPayloadHash(persisted: PersistedLedgerEntry): string {
  const preimage = [
    String(persisted.sequence),
    persisted.record.ledger_entry_id.trim(),
    persisted.record.execution_id.trim(),
    persisted.record.handler_intent_id.trim(),
    persisted.record.capability_id.trim(),
  ];
  return createHash("sha256").update(JSON.stringify(preimage)).digest("hex");
}
