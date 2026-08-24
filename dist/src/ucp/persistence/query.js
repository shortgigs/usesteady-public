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
import { loadIndex } from "./store.js";
import { readEnvelopeAt } from "./reader.js";
// ─── Single-envelope lookup ───────────────────────────────────────────────────
/**
 * Load one envelope by its content-addressed id.
 * Uses the byId byte-offset index for O(1) file seek.
 *
 * Returns null if the id is not in the index or the record is corrupt.
 */
export function getEnvelopeById(storeDir, id) {
    const index = loadIndex(storeDir);
    const offset = index.byId[id];
    if (offset === undefined)
        return null;
    return readEnvelopeAt(storeDir, offset);
}
// ─── Type-based bulk lookup ───────────────────────────────────────────────────
/**
 * Load all envelopes of a specific UCPType.
 * Uses byType index to identify ids, then resolves each via byId offset.
 *
 * Returns envelopes in index order (which matches append/log order).
 * Corrupt or missing records are skipped silently.
 */
export function getByType(storeDir, type) {
    const index = loadIndex(storeDir);
    const ids = index.byType[type] ?? [];
    const results = [];
    for (const id of ids) {
        const env = getEnvelopeById(storeDir, id);
        if (env !== null)
            results.push(env);
    }
    return results;
}
// ─── Chain navigation (byRoot) ────────────────────────────────────────────────
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
export function getChain(storeDir, intentId) {
    const index = loadIndex(storeDir);
    const results = [];
    // The intent envelope itself has no refs — it is the root.
    // It lives in byId but not in byRoot (nothing has rootId = intentId for the intent itself).
    const intentOffset = index.byId[intentId];
    if (intentOffset !== undefined) {
        const intentEnv = readEnvelopeAt(storeDir, intentOffset);
        if (intentEnv !== null)
            results.push(intentEnv);
    }
    // All descendant envelopes: their refs.rootId === intentId
    const childIds = index.byRoot[intentId] ?? [];
    for (const id of childIds) {
        const env = getEnvelopeById(storeDir, id);
        if (env !== null)
            results.push(env);
    }
    return results;
}
// ─── Artifact lookup ──────────────────────────────────────────────────────────
/**
 * Find the artifact envelope whose payload.runId matches.
 *
 * Uses byType["ucp.artifact.v1"] to limit the scan to artifact envelopes only.
 * Does NOT scan the full log. Returns null if no match is found.
 *
 * IMPORTANT: follows stored field values only — does not infer runId from context.
 */
export function getArtifactByRunId(storeDir, runId) {
    const index = loadIndex(storeDir);
    const ids = index.byType["ucp.artifact.v1"] ?? [];
    for (const id of ids) {
        const env = getEnvelopeById(storeDir, id);
        if (env === null)
            continue;
        if (env.type !== "ucp.artifact.v1")
            continue;
        // Type-narrow: payload has runId because type === "ucp.artifact.v1"
        const payload = env.payload;
        if (payload.runId === runId)
            return env;
    }
    return null;
}
// ─── Children of an artifact (byParent) ──────────────────────────────────────
/**
 * Find the execution trace envelope that is a direct child of `artifactEnvId`.
 *
 * A trace envelope declares refs.parentId === artifactEnvId.
 * Returns null if not found.
 */
export function getTraceByArtifactId(storeDir, artifactEnvId) {
    const index = loadIndex(storeDir);
    const childIds = index.byParent[artifactEnvId] ?? [];
    for (const id of childIds) {
        const env = getEnvelopeById(storeDir, id);
        if (env === null)
            continue;
        if (env.type === "ucp.execution_trace.v1") {
            return env;
        }
    }
    return null;
}
/**
 * Find the replay report envelope that is a direct child of `artifactEnvId`.
 *
 * A replay envelope declares refs.parentId === artifactEnvId.
 * Returns null if not found.
 */
export function getReplayByArtifactId(storeDir, artifactEnvId) {
    const index = loadIndex(storeDir);
    const childIds = index.byParent[artifactEnvId] ?? [];
    for (const id of childIds) {
        const env = getEnvelopeById(storeDir, id);
        if (env === null)
            continue;
        if (env.type === "ucp.replay_report.v1") {
            return env;
        }
    }
    return null;
}
/**
 * Find the reminder execution envelope that is a direct child of `responseEnvId`.
 *
 * A reminder execution envelope declares refs.parentId === responseEnvId.
 * Returns null if not found.
 *
 * Navigation: byParent[responseEnvId], filtered by type === "ucp.reminder_execution.v1".
 */
export function getReminderExecutionByResponseId(storeDir, responseEnvId) {
    const index = loadIndex(storeDir);
    const childIds = index.byParent[responseEnvId] ?? [];
    for (const id of childIds) {
        const env = getEnvelopeById(storeDir, id);
        if (env === null)
            continue;
        if (env.type === "ucp.reminder_execution.v1") {
            return env;
        }
    }
    return null;
}
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
export function getTimeline(storeDir, intentId) {
    const chain = getChain(storeDir, intentId);
    let intent = null;
    let response = null;
    let artifact = null;
    let reminderExecution = null;
    for (const env of chain) {
        switch (env.type) {
            case "ucp.intent.v1":
                intent = env;
                break;
            case "ucp.response.v1":
                response = env;
                break;
            case "ucp.artifact.v1":
                artifact = env;
                break;
            case "ucp.reminder_execution.v1":
                reminderExecution = env;
                break;
        }
    }
    // Trace and replay are children of the artifact envelope (standard execution branch)
    const trace = artifact !== null ? getTraceByArtifactId(storeDir, artifact.id) : null;
    const replay = artifact !== null ? getReplayByArtifactId(storeDir, artifact.id) : null;
    return { intent, response, artifact, trace, replay, reminderExecution };
}
//# sourceMappingURL=query.js.map