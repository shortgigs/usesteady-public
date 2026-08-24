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
import type { FsPlugin } from "../workflow/types.js";
/** Implementation identity carried on every record (evidence record §6). */
export declare const FS_BOUNDARY_OBSERVER_IMPLEMENTATION_ID = "FS_BOUNDARY_OBSERVER_V1";
/**
 * One boundary observation. `opCanonical`/`observedHash` describe ONLY the
 * operation object as received at this side of the seam — never coordinator
 * state, never adapter self-report.
 */
export type FsBoundaryRecord = {
    readonly recordType: "fs_boundary_observation.v1";
    readonly observerImpl: string;
    /** Process-global monotonic observation order (total order within a process). */
    readonly seq: number;
    readonly observedAtUtc: string;
    /** stableStringify(op) — the operation exactly as received. */
    readonly opCanonical: string;
    /** hashObject(op) — SHA-256 over opCanonical. */
    readonly observedHash: string;
};
export type FsBoundarySink = {
    append(record: FsBoundaryRecord): void;
};
/**
 * Wrap `inner` with boundary observation. Satisfies FsPlugin; the coordinator
 * cannot distinguish the observer from a bare adapter except by the records
 * appearing in the sink.
 */
export declare function makeFsBoundaryObserver(inner: FsPlugin, sink: FsBoundarySink): FsPlugin;
/**
 * Append-only JSONL file sink. The file handle is owned by the composition
 * root; the adapter never receives a reference to the sink or the records.
 */
export declare function makeJsonlBoundarySink(filePath: string): FsBoundarySink;
//# sourceMappingURL=fs-boundary-observer.d.ts.map