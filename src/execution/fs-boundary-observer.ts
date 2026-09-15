/**
 * FS Boundary Observer V1 — adapter-boundary invocation observation.
 *
 * An FsPlugin wrapper positioned by the composition root immediately before
 * the concrete adapter (last hands on the operation reference before
 * adapter-controlled code). Its purpose is evidentiary: produce a
 * deterministic record of the operation AS RECEIVED from the receiving side
 * of the invocation seam:
 *
 *   observedHash = hashObject(op)   — the FIRST meaningful operation
 *
 * computed before any adapter-controlled interpretation or transformation,
 * then forward the SAME operation reference to the underlying adapter.
 *
 * Rules:
 *   - Evidence derives only from the callee-side argument `op`. This module
 *     has no access to run state, coordinator state, or the adapter result.
 *   - The boundary hash is produced before the inner adapter is invoked.
 *   - Observe-only: the record never influences the call; the inner
 *     adapter's result is returned verbatim.
 *   - Sink failure never blocks execution.
 *
 * Scope: the default sink is a process-local append-only file. This
 * component provides receiving-side observation; it does not isolate
 * evidence custody from the producing process.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname }                 from "node:path";

import { hashObject, stableStringify } from "../ucp/hashes.js";
import type { FsPlugin }               from "../workflow/types.js";

/** Implementation identity carried on every record (evidence record §6). */
export const FS_BOUNDARY_OBSERVER_IMPLEMENTATION_ID = "FS_BOUNDARY_OBSERVER_V1";

/**
 * One boundary observation. `opCanonical`/`observedHash` describe ONLY the
 * operation object as received at this side of the seam — never coordinator
 * state, never adapter self-report.
 */
export type FsBoundaryRecord = {
  readonly recordType:    "fs_boundary_observation.v1";
  readonly observerImpl:  string;
  /** Process-global monotonic observation order (total order within a process). */
  readonly seq:           number;
  readonly observedAtUtc: string;
  /** stableStringify(op) — the operation exactly as received. */
  readonly opCanonical:   string;
  /** hashObject(op) — SHA-256 over opCanonical. */
  readonly observedHash:  string;
};

export type FsBoundarySink = {
  append(record: FsBoundaryRecord): void;
};

/**
 * Process-global sequence counter. Shared across observer instances so records
 * from different runs in the same process keep a total order in a shared sink.
 */
let processSeq = 0;

/**
 * Wrap `inner` with boundary observation. Satisfies FsPlugin; the coordinator
 * cannot distinguish the observer from a bare adapter except by the records
 * appearing in the sink.
 */
export function makeFsBoundaryObserver(
  inner: FsPlugin,
  sink:  FsBoundarySink,
): FsPlugin {
  return {
    async executeFsOp(op) {
      // FIRST meaningful operation: hash the callee-side argument, before any
      // adapter-controlled interpretation or transformation.
      const observedHash = hashObject(op);
      const record: FsBoundaryRecord = {
        recordType:    "fs_boundary_observation.v1",
        observerImpl:  FS_BOUNDARY_OBSERVER_IMPLEMENTATION_ID,
        seq:           processSeq++,
        observedAtUtc: new Date().toISOString(),
        opCanonical:   stableStringify(op),
        observedHash,
      };
      try {
        sink.append(record);
      } catch (err) {
        // Observe-only: a failed sink write must not block the approved
        // operation. The missing record fails closed at verification
        // (NOT ESTABLISHED), which is where absence is adjudicated.
        console.error(
          "[fs-boundary-observer] sink append failed (record absent → correspondence NOT ESTABLISHED at verification):",
          err instanceof Error ? err.message : String(err),
        );
      }
      // Forward the SAME operation reference; return the adapter result verbatim.
      return inner.executeFsOp(op);
    },
  };
}

/**
 * Append-only JSONL file sink. The file handle is owned by the composition
 * root; the adapter never receives a reference to the sink or the records.
 */
export function makeJsonlBoundarySink(filePath: string): FsBoundarySink {
  let prepared = false;
  return {
    append(record) {
      if (!prepared) {
        mkdirSync(dirname(filePath), { recursive: true });
        prepared = true;
      }
      appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
    },
  };
}
