/**
 * Durable append-only executor ledger store — no execution / jobs / UI (INV-PERS-5..7).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExecutionLedgerRecord } from "../ledger/types.js";
import type {
  AppendLedgerEntryInput,
  PersistedLedgerEntry,
  ReplayLedgerEntriesInput,
} from "./types.js";
import { PersistenceRejectedError } from "./types.js";

export const EXECUTOR_LEDGER_STORE_DIRNAME = "executor-ledger";
export const EXECUTOR_LEDGER_JSONL_FILENAME = "ledger.jsonl";

function reject(rejection_cause: string, explain: string): never {
  throw new PersistenceRejectedError(rejection_cause, explain);
}

function ledgerJsonlPath(store_dir: string): string {
  return join(store_dir, EXECUTOR_LEDGER_STORE_DIRNAME, EXECUTOR_LEDGER_JSONL_FILENAME);
}

function isRecordIncomplete(record: ExecutionLedgerRecord): boolean {
  if (record.ledger_entry_id.trim().length === 0) return true;
  if (record.handler_intent_id.trim().length === 0) return true;
  if (record.execution_id.trim().length === 0) return true;
  if (record.capability_id.trim().length === 0) return true;
  if (record.recorded_at.trim().length === 0) return true;
  if (record.actor.kind !== "operator") return true;
  if (record.actor.actor_id.trim().length === 0) return true;
  if (record.lineage.length === 0) return true;
  if (record.intent_snapshot.handler_intent_id.trim().length === 0) return true;
  return false;
}

function parseStoreLine(line: string, lineNumber: number): PersistedLedgerEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    reject(
      "ledger_store_corrupt",
      `Ledger store line ${lineNumber} is not valid JSON.`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sequence" in parsed) ||
    !("record" in parsed)
  ) {
    reject(
      "ledger_store_corrupt",
      `Ledger store line ${lineNumber} is missing sequence or record.`,
    );
  }

  const row = parsed as { sequence: unknown; record: unknown };
  if (typeof row.sequence !== "number" || !Number.isInteger(row.sequence) || row.sequence < 0) {
    reject(
      "ledger_store_corrupt",
      `Ledger store line ${lineNumber} has invalid sequence.`,
    );
  }

  return {
    sequence: row.sequence,
    record:   row.record as ExecutionLedgerRecord,
  };
}

/** Load all persisted entries in append order (immutable prior lines). */
export function loadPersistedLedgerEntries(store_dir: string): readonly PersistedLedgerEntry[] {
  const path = ledgerJsonlPath(store_dir);
  if (!existsSync(path)) {
    return [];
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    reject("ledger_store_io_failed", "Failed to read executor ledger store.");
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const entries: PersistedLedgerEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    entries.push(parseStoreLine(lines[i]!, i + 1));
  }
  return entries.sort((a, b) => a.sequence - b.sequence);
}

/**
 * Append one `ExecutionLedgerRecord` to the durable store (append-only).
 * Returns the persisted envelope with monotonic `sequence`.
 */
export function appendLedgerEntry(input: AppendLedgerEntryInput): PersistedLedgerEntry {
  const record = input.record;

  if (isRecordIncomplete(record)) {
    reject("ledger_entry_incomplete", "Execution ledger record is incomplete.");
  }

  const store_dir = input.store_dir.trim();
  if (store_dir.length === 0) {
    reject("ledger_store_invalid", "Ledger store directory is empty.");
  }

  const existing = loadPersistedLedgerEntries(store_dir);
  if (existing.some((entry) => entry.record.ledger_entry_id === record.ledger_entry_id)) {
    reject(
      "ledger_entry_already_persisted",
      `Ledger entry ${record.ledger_entry_id} is already persisted.`,
    );
  }

  const sequence =
    existing.length === 0
      ? 0
      : Math.max(...existing.map((entry) => entry.sequence)) + 1;

  const persisted: PersistedLedgerEntry = {
    sequence,
    record: structuredClone(record),
  };

  const ledgerDir = join(store_dir, EXECUTOR_LEDGER_STORE_DIRNAME);
  try {
    mkdirSync(ledgerDir, { recursive: true });
    appendFileSync(
      ledgerJsonlPath(store_dir),
      `${JSON.stringify(persisted)}\n`,
      "utf8",
    );
  } catch {
    reject("ledger_store_io_failed", "Failed to append executor ledger entry.");
  }

  return persisted;
}

/**
 * Descriptive replay by `execution_id` — append order preserved (INV-PERS-3).
 * Does not execute handlers, run background work, or mutate stored bytes.
 */
export function replayLedgerEntriesByExecutionId(
  input: ReplayLedgerEntriesInput,
): readonly PersistedLedgerEntry[] {
  const execution_id = input.execution_id.trim();
  if (execution_id.length === 0) {
    reject("ledger_entry_not_found", "execution_id is required for replay.");
  }

  const matches = loadPersistedLedgerEntries(input.store_dir).filter(
    (entry) => entry.record.execution_id === execution_id,
  );

  return matches.map((entry) => ({
    sequence: entry.sequence,
    record:   structuredClone(entry.record),
  }));
}
