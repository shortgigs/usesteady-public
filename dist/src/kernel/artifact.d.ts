/**
 * Kernel v1 — artifact construction and checksum.
 *
 * Pure. No I/O. No time. No randomness.
 *
 * ── Canonicalization ─────────────────────────────────────────────────────────
 *
 *   checksum = sha256(stableStringify({ ir, result }))
 *
 *   stableStringify (from src/ucp/hashes.ts) sorts object keys alphabetically
 *   at every level, so two artifacts built from the same content — regardless
 *   of key-insertion order — produce byte-identical canonical JSON and thus
 *   identical checksums.
 *
 *   The outer `version` field of KernelArtifact is NOT included in the hash
 *   input. It lives on the envelope only, so bumping the format version does
 *   not invalidate prior checksums over the same { ir, result } pair.
 */
import type { WorkflowSpec } from "../workflow/types.js";
import type { KernelArtifact, KernelResult } from "./types.js";
export type WorkflowRunLike = {
    readonly spec: {
        readonly tasks: readonly unknown[];
    };
    readonly tasks: readonly {
        readonly outcome: string;
    }[];
};
export declare function buildKernelResultFromRun(run: WorkflowRunLike, succeeded: boolean, errorCode: string | null): KernelResult;
export declare function computeKernelChecksum(ir: WorkflowSpec, result: KernelResult): string;
export declare function buildKernelArtifact(ir: WorkflowSpec, result: KernelResult): KernelArtifact;
//# sourceMappingURL=artifact.d.ts.map