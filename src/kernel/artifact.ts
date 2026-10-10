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

import { stableStringify, sha256 } from "../ucp/hashes.js";
import type { WorkflowSpec } from "../workflow/types.js";
import type { KernelArtifact, KernelResult } from "./types.js";

// ─── Structural input for buildKernelResultFromRun ───────────────────────────
// Loose structural type so this module does not depend on workflow coordinator
// internals beyond the two fields it reads.

export type WorkflowRunLike = {
  readonly spec:  { readonly tasks: readonly unknown[] };
  readonly tasks: readonly { readonly outcome: string }[];
};

// ─── buildKernelResultFromRun ────────────────────────────────────────────────
// Maps a terminal workflow run (plus the pre-computed success/error values that
// the CLI finalize block already derives) into the deterministic KernelResult
// summary. Does not invent fields; does not read stdout/stderr.

export function buildKernelResultFromRun(
  run:       WorkflowRunLike,
  succeeded: boolean,
  errorCode: string | null,
): KernelResult {
  const total_steps    = run.spec.tasks.length;
  const executed_steps = run.tasks.filter(t => t.outcome === "accepted").length;
  const failedIdx      = run.tasks.findIndex(
    t => t.outcome !== "accepted" && t.outcome !== "pending",
  );
  const failed_at_step = failedIdx === -1 ? null : failedIdx + 1;

  return {
    success:        succeeded,
    error:          errorCode,
    executed_steps,
    failed_at_step,
    total_steps,
  };
}

// ─── computeKernelChecksum ───────────────────────────────────────────────────
// The single source of truth for what "checksum" means in kernel.v1.
// Any future change to this function is a breaking change to artifact identity
// and MUST bump the artifact version string.

export function computeKernelChecksum(
  ir:     WorkflowSpec,
  result: KernelResult,
): string {
  return sha256(stableStringify({ ir, result }));
}

// ─── buildKernelArtifact ─────────────────────────────────────────────────────
// Assembles the full on-disk record. The checksum is computed from { ir, result }
// only — version is excluded from the hash input by design.

export function buildKernelArtifact(
  ir:     WorkflowSpec,
  result: KernelResult,
): KernelArtifact {
  return {
    version:  "kernel.v1",
    ir,
    result,
    checksum: computeKernelChecksum(ir, result),
  };
}
