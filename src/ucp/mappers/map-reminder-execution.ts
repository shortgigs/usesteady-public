/**
 * Mapper: ReminderExecutionArtifact → ReminderExecutionEnvelope.
 *
 * Maps from a finalized reminder execution artifact to its canonical UCP envelope.
 *
 * ── Mapping rules (field-for-field) ──────────────────────────────────────────
 *
 *   subject           ← artifact.subject                    (direct copy)
 *   time_text         ← artifact.time_text                  (direct copy)
 *   parsed_time_kind  ← artifact.parsed_time.kind           (kind only — see note)
 *   recurrence_text   ← artifact.recurrence_text            (direct copy)
 *   source_confidence ← artifact.source_confidence          (direct copy)
 *   verdict           ← artifact.verdict                    (direct copy)
 *   rejection_reason  ← artifact.rejection_reason           (direct copy, optional)
 *
 * ── Why parsed_time_kind only ────────────────────────────────────────────────
 *
 *   The envelope records the execution-classification outcome: was the time
 *   parseable, and of what structural shape? It does NOT carry the full
 *   ParsedTime (hour, minute, period, offset_minutes, etc.) because:
 *
 *     1. The envelope is a lightweight canonical record, not a scheduler payload.
 *     2. The full ParsedTime lives in the artifact for downstream integrations.
 *     3. This keeps the envelope consistent with the Phase 3 pattern:
 *        artifact envelopes carry identity signals, not full data copies.
 *
 * ── What this mapper does NOT do ─────────────────────────────────────────────
 *
 *   ✗ Recompute or reinterpret any field
 *   ✗ Copy the full ParsedTime struct (only kind is copied)
 *   ✗ Add renderer-facing concerns
 *   ✗ Validate the artifact (validation happens in the executor before this)
 *
 * ── CONSTRUCTION RULE: undefined-free payloads ────────────────────────────────
 *
 *   Optional fields (rejection_reason) must be omitted entirely when absent.
 *   Never assign a payload key to `undefined` — stableStringify serializes
 *   `undefined` as the string "undefined", which breaks content addressing.
 *   Use conditional spreading: ...(value !== undefined ? { key: value } : {})
 *
 *   This is the mapper where this invariant was discovered (Phase 7 audit).
 *   See: src/ucp/types.ts — "PROTOCOL INVARIANT: Payloads must be undefined-free"
 */

import { createReminderExecutionEnvelope } from "../envelope.js";
import type { ReminderExecutionEnvelope, UCPRefs } from "../types.js";
import type { ReminderExecutionArtifact } from "../../execution/reminders/reminder-execution-types.js";

/**
 * Map a finalized reminder execution artifact to its canonical UCP envelope.
 *
 * Pure function — same artifact → same envelope id (content-addressed).
 *
 * @param artifact  The finalized ReminderExecutionArtifact from executeReminder().
 * @param refs      Optional provenance refs:
 *                    refs.rootId   = ucp.intent.v1 ID (closes provenance chain)
 *                    refs.parentId = ucp.response.v1 ID (immediate predecessor)
 */
export function mapReminderExecutionToEnvelope(
  artifact: ReminderExecutionArtifact,
  refs?: UCPRefs,
): ReminderExecutionEnvelope {
  const payload = {
    subject:           artifact.subject,
    time_text:         artifact.time_text,
    parsed_time_kind:  artifact.parsed_time.kind,
    recurrence_text:   artifact.recurrence_text,
    source_confidence: artifact.source_confidence,
    verdict:           artifact.verdict,
    ...(artifact.rejection_reason !== undefined
      ? { rejection_reason: artifact.rejection_reason }
      : {}),
  } as const;

  return createReminderExecutionEnvelope(payload, refs);
}
