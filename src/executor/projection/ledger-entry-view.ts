/**
 * B3 — Read-only executor ledger projection (Lane A boundary seam).
 *
 * Decouples Lane B (and any other read-only consumer) from the internal
 * snake_case `ExecutionLedgerRecord` by mapping a `PersistedLedgerEntry` into a
 * frozen, camelCase, content-stable view.
 *
 * Pure: no I/O, no time, no randomness. Read-only: this module never writes,
 * appends, executes, or mutates. It is the public-surface projection that
 * `src/index.ts` exposes so consumers read append-only governance records
 * without importing executor internals.
 *
 * @see docs/product/b3-readonly-executor-ledger-seam-v1.md
 * @see docs/product/executor-persistence-contract-v1.md
 */

import type { PersistedLedgerEntry } from "../persistence/types.js";
import type { ExecutionLedgerLineageKind } from "../ledger/types.js";

export const EXECUTION_LEDGER_VIEW_VERSION = "executor.ledger.view.v1" as const;

export type ExecutionLedgerLineageView = {
  readonly at: string;
  readonly kind: ExecutionLedgerLineageKind;
  /** Coalesced from the optional internal field — never `undefined`. */
  readonly priorLedgerEntryId: string | null;
  /** Coalesced from the optional internal field — never `undefined`. */
  readonly note: string | null;
};

export type ExecutionLedgerIntentView = {
  readonly handlerIntentId: string;
  readonly capabilityId: string;
  readonly handlerKind: "descriptive";
  readonly intentSummary: string;
  readonly targetScope: readonly string[];
  readonly riskNotes: readonly string[];
};

/** Frozen, read-only projection of one durable append-only ledger entry. */
export type ExecutionLedgerEntryView = {
  readonly version: typeof EXECUTION_LEDGER_VIEW_VERSION;
  readonly sequence: number;
  readonly ledgerEntryId: string;
  readonly executionId: string;
  readonly handlerIntentId: string;
  readonly capabilityId: string;
  readonly actor: { readonly kind: "operator"; readonly actorId: string };
  readonly recordedAt: string;
  readonly intent: ExecutionLedgerIntentView;
  readonly lineage: readonly ExecutionLedgerLineageView[];
};

/**
 * Map a persisted ledger entry to its read-only view. Pure and deterministic.
 *
 * Optional internal lineage fields (`prior_ledger_entry_id?`, `note?`) are
 * coalesced to explicit `null` so the view is total and compiles clean under
 * `exactOptionalPropertyTypes`.
 */
export function mapLedgerEntryToView(
  entry: PersistedLedgerEntry,
): ExecutionLedgerEntryView {
  const { record } = entry;
  return {
    version:         EXECUTION_LEDGER_VIEW_VERSION,
    sequence:        entry.sequence,
    ledgerEntryId:   record.ledger_entry_id,
    executionId:     record.execution_id,
    handlerIntentId: record.handler_intent_id,
    capabilityId:    record.capability_id,
    actor: {
      kind:    record.actor.kind,
      actorId: record.actor.actor_id,
    },
    recordedAt: record.recorded_at,
    intent: {
      handlerIntentId: record.intent_snapshot.handler_intent_id,
      capabilityId:    record.intent_snapshot.capability_id,
      handlerKind:     record.intent_snapshot.handler_kind,
      intentSummary:   record.intent_snapshot.intent_summary,
      targetScope:     record.intent_snapshot.target_scope,
      riskNotes:       record.intent_snapshot.risk_notes,
    },
    lineage: record.lineage.map((l) => ({
      at:                l.at,
      kind:              l.kind,
      priorLedgerEntryId: l.prior_ledger_entry_id ?? null,
      note:              l.note ?? null,
    })),
  };
}
