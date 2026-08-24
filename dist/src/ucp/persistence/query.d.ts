/**
 * UCP Persistence Query Layer — navigation over the UCP envelope history.
 *
 * Every query function in this module ONLY follows explicit refs (parentId, rootId)
 * or field values stored in the payload. No relationship is inferred.
 *
 * ── Design constraints ────────────────────────────────────────────────────────
 *
 *   1. Refs-only navigation — getChain follows refs.rootId, child lookups follow
 *      refs.parentId. No structural inference beyond what refs declare.
 *
 *   2. No caching — each call reads from disk via reader.ts. Caching is deferred.
 *
 *   3. Type-narrowed returns — artifact/trace/replay queries return typed aliases.
 *      Narrowing is done by checking envelope.type before casting — never blindly.
 *
 *   4. Null-safe — all queries return null or empty array rather than throwing
 *      when data is missing or corrupt.
 *
 *   5. Zero mutation — returned envelopes are the exact parsed records; nothing
 *      is modified, sorted, or enriched by this layer.
 *
 *   6. No authority — queries are read-only observability tools. They must not
 *      affect any runtime, intake, or execution behavior.
 *
 * ── Query function summary ────────────────────────────────────────────────────
 *
 *   getEnvelopeById                  — load one envelope by id (uses byId index offset)
 *   getByType                        — load all envelopes for a type (uses byType index)
 *   getChain                         — load all envelopes for an intent (uses byRoot index)
 *   getArtifactByRunId               — find artifact by payload.runId
 *   getTraceByArtifactId             — find execution trace parented to an artifact env
 *   getReplayByArtifactId            — find replay report parented to an artifact env
 *   getReminderExecutionByResponseId — find reminder execution parented to a response env
 *   getTimeline                      — full run reconstruction from an intentId
 *
 * ── Provenance chain (how envelopes link) ─────────────────────────────────────
 *
 *   ucp.intent.v1                — no refs (it is the root)
 *   ucp.response.v1              — parentId = intentId,    rootId = intentId
 *   ucp.artifact.v1              — rootId = intentId
 *   ucp.execution_trace.v1       — parentId = artifactEnvId, rootId = intentId
 *   ucp.replay_report.v1         — parentId = artifactEnvId, rootId = intentId
 *   ucp.reminder_execution.v1    — parentId = responseEnvId, rootId = intentId
 *
 *   byRoot[intentId] covers: response + artifact + trace + replay + reminder_execution
 *   byParent[artifactEnvId] covers: trace + replay
 *   byParent[responseEnvId] covers: reminder_execution
 */
import type { UCPEnvelope, UCPType, ArtifactPayload, ArtifactEnvelope, ExecutionTracePayload, ExecutionTraceEnvelope, ReplayReportPayload, ReplayReportEnvelope, ReminderExecutionPayload, ReminderExecutionEnvelope } from "../types.js";
/**
 * Load one envelope by its content-addressed id.
 * Uses the byId byte-offset index for O(1) file seek.
 *
 * Returns null if the id is not in the index or the record is corrupt.
 */
export declare function getEnvelopeById(storeDir: string, id: string): UCPEnvelope<unknown> | null;
/**
 * Load all envelopes of a specific UCPType.
 * Uses byType index to identify ids, then resolves each via byId offset.
 *
 * Returns envelopes in index order (which matches append/log order).
 * Corrupt or missing records are skipped silently.
 */
export declare function getByType(storeDir: string, type: UCPType): UCPEnvelope<unknown>[];
/**
 * Load the full provenance chain for an intent.
 *
 * Returns the intent envelope itself plus every envelope that declares
 * refs.rootId === intentId. This covers: response, artifact, trace, replay.
 *
 * Envelopes are returned in log order (chronological).
 *
 * Returns an empty array if intentId is not found in the index.
 */
export declare function getChain(storeDir: string, intentId: string): UCPEnvelope<unknown>[];
/**
 * Find the artifact envelope whose payload.runId matches.
 *
 * Uses byType["ucp.artifact.v1"] to limit the scan to artifact envelopes only.
 * Does NOT scan the full log. Returns null if no match is found.
 *
 * IMPORTANT: follows stored field values only — does not infer runId from context.
 */
export declare function getArtifactByRunId(storeDir: string, runId: string): ArtifactEnvelope | null;
/**
 * Find the execution trace envelope that is a direct child of `artifactEnvId`.
 *
 * A trace envelope declares refs.parentId === artifactEnvId.
 * Returns null if not found.
 */
export declare function getTraceByArtifactId(storeDir: string, artifactEnvId: string): ExecutionTraceEnvelope | null;
/**
 * Find the replay report envelope that is a direct child of `artifactEnvId`.
 *
 * A replay envelope declares refs.parentId === artifactEnvId.
 * Returns null if not found.
 */
export declare function getReplayByArtifactId(storeDir: string, artifactEnvId: string): ReplayReportEnvelope | null;
/**
 * Find the reminder execution envelope that is a direct child of `responseEnvId`.
 *
 * A reminder execution envelope declares refs.parentId === responseEnvId.
 * Returns null if not found.
 *
 * Navigation: byParent[responseEnvId], filtered by type === "ucp.reminder_execution.v1".
 */
export declare function getReminderExecutionByResponseId(storeDir: string, responseEnvId: string): ReminderExecutionEnvelope | null;
/**
 * A complete run timeline reconstructed from the UCP log.
 *
 * All fields may be null — a field is null when the corresponding envelope
 * has not yet been persisted, or was not found in the index.
 *
 * null does NOT mean failure — it means that phase of the run is not (yet) recorded.
 *
 * ── Branch structure ──────────────────────────────────────────────────────────
 *
 *   Standard execution branch:
 *     intent → response → artifact → trace + replay
 *
 *   Reminder execution branch (Phase 6):
 *     intent → response → reminderExecution
 *
 *   Both branches may be null — they are mutually exclusive in practice but
 *   the type system does not enforce exclusivity (both fields may be non-null
 *   if a run somehow produced both, though this should not occur).
 */
export type RunTimeline = {
    /** The originating intent, if found. */
    readonly intent: UCPEnvelope<unknown> | null;
    /** The response envelope (mode + reason + guidance), if found. */
    readonly response: UCPEnvelope<unknown> | null;
    /** The artifact envelope (runId + goal + checksum), if found. */
    readonly artifact: ArtifactEnvelope | null;
    /** The execution trace envelope (traceHash + kinds), if found. */
    readonly trace: ExecutionTraceEnvelope | null;
    /** The replay report envelope (verdict + counts), if found. */
    readonly replay: ReplayReportEnvelope | null;
    /**
     * The reminder execution envelope (verdict + time classification), if found.
     *
     * Present for runs that went through the reminder execution path (Phase 6).
     * null for all standard (non-reminder) runs.
     *
     * Navigation: byRoot[intentId] scan → type === "ucp.reminder_execution.v1".
     */
    readonly reminderExecution: ReminderExecutionEnvelope | null;
};
/**
 * Reconstruct a full run timeline from an intent envelope id.
 *
 * Navigation is strictly refs-based:
 *   1. intentId          → intent envelope (byId lookup)
 *   2. byRoot[intentId]  → all descendants; typed by envelope.type
 *   3. artifact env id   → trace and replay (byParent lookup)
 *   4. byRoot scan       → reminderExecution (type === "ucp.reminder_execution.v1")
 *
 * No inference. No relationship reconstruction beyond what refs declare.
 * Returns a RunTimeline where missing envelopes are null.
 */
export declare function getTimeline(storeDir: string, intentId: string): RunTimeline;
export type { ArtifactPayload, ExecutionTracePayload, ReplayReportPayload, ReminderExecutionPayload };
//# sourceMappingURL=query.d.ts.map