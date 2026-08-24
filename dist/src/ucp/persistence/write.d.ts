/**
 * UCP Persistence — persistEnvelope facade.
 *
 * This is the single public call site for persisting a UCP envelope.
 * It wraps the raw store operations in a try/catch so that persistence
 * failures NEVER surface as execution failures.
 *
 * Callers (server.ts, CLI shell) must call this inside a fire-and-forget
 * async block — this module itself is synchronous.
 *
 * ── Authority ────────────────────────────────────────────────────────────────
 *
 *   persistEnvelope is zero-authority.
 *   A persistence failure must never:
 *     - cause a run to fail
 *     - change mode or execution behavior
 *     - surface to the renderer
 *
 *   The only observable side effect of failure is a console.warn line.
 */
import type { UCPEnvelope } from "../types.js";
/**
 * Persist one UCP envelope to the store directory.
 *
 * Appends to envelopes.log and updates index.json atomically.
 * Never throws — errors are swallowed with console.warn.
 *
 * Use for: post-execution envelopes where a persistence failure must not
 * block or change system behavior (fire-and-forget semantics).
 *
 * @param storeDir  Absolute path to the UCP store directory.
 * @param envelope  The UCP envelope to persist.
 */
export declare function persistEnvelope(storeDir: string, envelope: UCPEnvelope<unknown>): void;
/**
 * Persist one UCP envelope to the store directory, throwing on failure.
 *
 * Unlike persistEnvelope, this function DOES throw if persistence fails.
 * Use for: pre-delivery gates where a persistence failure must block the
 * subsequent action (e.g., cursor handoff — delivery must not proceed if
 * the provenance record cannot be written).
 *
 * @param storeDir  Absolute path to the UCP store directory.
 * @param envelope  The UCP envelope to persist.
 * @throws          If appending or indexing fails for any reason.
 */
export declare function persistEnvelopeOrThrow(storeDir: string, envelope: UCPEnvelope<unknown>): void;
//# sourceMappingURL=write.d.ts.map