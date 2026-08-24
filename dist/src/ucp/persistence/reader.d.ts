/**
 * UCP Persistence Reader — low-level log file reads.
 *
 * Provides two read primitives:
 *   readEnvelopeAt   — seek to a byte offset, read one line, parse one envelope
 *   readAllEnvelopes — scan the full log, parse all valid lines
 *
 * ── Design constraints ────────────────────────────────────────────────────────
 *
 *   1. Read-only — these functions never write to disk.
 *   2. Null-safe — missing file or corrupt line returns null / is skipped.
 *   3. No caching — each call reads from disk. Caching is a Phase 4C concern.
 *   4. No inference — returns raw parsed envelope exactly as stored.
 *
 * ── Performance note ──────────────────────────────────────────────────────────
 *
 *   readEnvelopeAt uses openSync/readSync to seek without loading the full file.
 *   Chunk size of 64 KB covers virtually all real envelope sizes. For unusually
 *   large payloads, the chunk is extended automatically.
 *
 *   readAllEnvelopes reads the full file once and splits by newline.
 *   This is correct for Phase 4B; rotation / streaming is a future concern.
 */
import type { UCPEnvelope } from "../types.js";
/**
 * Read and parse the envelope stored at `offset` bytes in envelopes.log.
 *
 * Returns null if:
 *   - The log file does not exist
 *   - The offset is beyond the end of file
 *   - The line at that offset is not valid JSON
 *
 * Does NOT verify the envelope hash. Integrity checks are a query-layer concern.
 */
export declare function readEnvelopeAt(storeDir: string, offset: number): UCPEnvelope<unknown> | null;
/**
 * Read and parse all valid envelopes from envelopes.log.
 *
 * Corrupt or unparseable lines are skipped silently.
 * Returns envelopes in log order (chronological, oldest first).
 */
export declare function readAllEnvelopes(storeDir: string): UCPEnvelope<unknown>[];
//# sourceMappingURL=reader.d.ts.map