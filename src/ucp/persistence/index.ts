/**
 * UCP Persistence — public API.
 *
 * Phase 4A — store + write:
 *   persistEnvelope   — fire-and-forget facade (callers use this)
 *   appendEnvelope    — raw log append (returns byte offset)
 *   loadIndex / updateIndex / rebuildIndex — index management
 *
 * Phase 4B — reader + query:
 *   readEnvelopeAt    — seek to byte offset, parse one envelope
 *   readAllEnvelopes  — full log scan
 *   getEnvelopeById   — O(1) id lookup via index
 *   getByType         — type-filtered bulk lookup
 *   getChain          — full intent provenance chain via byRoot
 *   getArtifactByRunId / getTraceByArtifactId / getReplayByArtifactId
 *   getTimeline       — complete run reconstruction from intentId
 */

export type { UCPIndex } from "./store.js";
export {
  LOG_FILENAME,
  INDEX_FILENAME,
  emptyIndex,
  ensureStoreDir,
  appendEnvelope,
  loadIndex,
  updateIndex,
  rebuildIndex,
} from "./store.js";

export { persistEnvelope } from "./write.js";

export { readEnvelopeAt, readAllEnvelopes } from "./reader.js";

export type { RunTimeline } from "./query.js";
export {
  getEnvelopeById,
  getByType,
  getChain,
  getArtifactByRunId,
  getTraceByArtifactId,
  getReplayByArtifactId,
  getReminderExecutionByResponseId,
  getTimeline,
} from "./query.js";
