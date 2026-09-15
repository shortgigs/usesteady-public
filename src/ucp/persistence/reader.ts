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

import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { LOG_FILENAME } from "./store.js";
import type { UCPEnvelope } from "../types.js";

// ─── Single-envelope seek read ────────────────────────────────────────────────

const INITIAL_CHUNK_BYTES = 65_536; // 64 KB — enough for all realistic envelope sizes

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
export function readEnvelopeAt(storeDir: string, offset: number): UCPEnvelope<unknown> | null {
  const logPath = join(storeDir, LOG_FILENAME);
  if (!existsSync(logPath)) return null;

  const fd = openSync(logPath, "r");
  try {
    let chunkSize = INITIAL_CHUNK_BYTES;
    let line: string | null = null;

    while (line === null) {
      const buffer   = Buffer.alloc(chunkSize);
      const bytesRead = readSync(fd, buffer, 0, chunkSize, offset);

      if (bytesRead === 0) return null; // offset beyond EOF

      const text = buffer.slice(0, bytesRead).toString("utf8");
      const newlineIdx = text.indexOf("\n");

      if (newlineIdx !== -1) {
        // Found end of line within the chunk
        line = text.slice(0, newlineIdx);
      } else if (bytesRead < chunkSize) {
        // EOF reached before newline — the file ends without trailing newline
        line = text;
      } else {
        // Line exceeds chunk size — double and retry
        chunkSize *= 2;
      }
    }

    if (line.trim() === "") return null;
    return JSON.parse(line) as UCPEnvelope<unknown>;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// ─── Full log scan ────────────────────────────────────────────────────────────

/**
 * Read and parse all valid envelopes from envelopes.log.
 *
 * Corrupt or unparseable lines are skipped silently.
 * Returns envelopes in log order (chronological, oldest first).
 */
export function readAllEnvelopes(storeDir: string): UCPEnvelope<unknown>[] {
  const logPath = join(storeDir, LOG_FILENAME);
  if (!existsSync(logPath)) return [];

  const raw     = readFileSync(logPath, "utf8");
  const lines   = raw.split("\n");
  const results: UCPEnvelope<unknown>[] = [];

  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      results.push(JSON.parse(line) as UCPEnvelope<unknown>);
    } catch {
      // Corrupt line — skip
    }
  }

  return results;
}
