/**
 * Mapper: ArtifactLike (trace portion) → ExecutionTraceEnvelope.
 *
 * Seals the full execution timeline for one run as a lightweight identity
 * envelope. Individual trace entries are not copied — they are represented
 * by a content hash (traceHash) and a sequence of kind strings.
 *
 * ── traceHash specification (5 locked rules) ─────────────────────────────────
 *
 *   1. Ordering:       Recorded/append order — same as artifact.trace[] index order.
 *                      No resorting.
 *   2. Included:       ALL TraceEntry fields: kind, runId, nodeId, timestampMs, payload.
 *   3. Excluded:       None. No derived summaries or presentation fields.
 *   4. Timestamps:     timestampMs IS included. Two runs at different times produce
 *                      different traceHash values. This is correct — each trace is
 *                      a specific, time-stamped execution record.
 *   5. Serialization:  stableStringify() — sorted keys at all nesting levels.
 *                      Same algorithm as FinalizedArtifact.checksum computation.
 *
 * ── Mapping rules ─────────────────────────────────────────────────────────────
 *
 *   runId       ← artifact.runId
 *   entryCount  ← artifact.trace.length
 *   kinds       ← artifact.trace.map(e => e.kind)  (ordered, string values)
 *   traceHash   ← hashObject(artifact.trace)
 *
 * ── What this mapper does NOT do ─────────────────────────────────────────────
 *
 *   ✗ Copy individual trace entry payloads, nodeIds, or timestamps
 *   ✗ Reshape or reorder trace entries
 *   ✗ Add derived summaries or presentation fields
 *   ✗ Affect FinalizedArtifact.checksum
 */

import { createExecutionTraceEnvelope } from "../envelope.js";
import { hashObject } from "../hashes.js";
import type { ExecutionTraceEnvelope, UCPRefs } from "../types.js";

/**
 * Minimal structural type for one trace entry.
 * Consumers pass objects with kind, runId, nodeId, timestampMs, payload.
 * We access .kind for the kinds[] field; the full entry is hashed as-is.
 */
export type TraceEntryLike = {
  readonly kind: string;
  readonly [key: string]: unknown;
};

/**
 * Minimal structural type for the artifact's trace portion.
 */
export type ArtifactWithTraceLike = {
  readonly runId: string;
  readonly trace: ReadonlyArray<TraceEntryLike>;
};

/**
 * Map an artifact's execution trace to its canonical sealed envelope.
 *
 * Pure function — same trace → same envelope id.
 * Note: traceHash will differ between runs even for identical logic, because
 * timestampMs is included per the locked spec.
 *
 * @param artifact  Must have runId and trace[] satisfying the shapes above
 * @param refs      Optional provenance refs:
 *                    refs.parentId = ucp.artifact.v1 ID (immediate predecessor)
 *                    refs.rootId   = ucp.intent.v1 ID  (originating intent)
 */
export function mapExecutionTraceToEnvelope(
  artifact: ArtifactWithTraceLike,
  refs?: UCPRefs,
): ExecutionTraceEnvelope {
  const trace = artifact.trace;
  return createExecutionTraceEnvelope(
    {
      runId:      artifact.runId,
      entryCount: trace.length,
      kinds:      trace.map((e) => e.kind),
      traceHash:  hashObject(trace),
    },
    refs,
  );
}
