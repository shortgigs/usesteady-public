/**
 * Kernel v1 — verification-only replay.
 *
 * ── Scope (PR-K1, locked) ────────────────────────────────────────────────────
 *
 *   This is NOT workflow re-execution. This is artifact integrity verification.
 *
 *   Given a persisted KernelArtifact, recompute
 *     sha256(stableStringify({ ir, result }))
 *   from the stored `ir` and `result` fields and compare it to the stored
 *   `checksum`. If they agree, the artifact is self-consistent. If not, the
 *   artifact has been mutated, corrupted, or was produced by a broken writer.
 *
 *   Full workflow re-execution is deferred to a later kernel PR. This module
 *   does NOT spawn processes, mutate process.argv, import main.js, touch the
 *   workflow coordinator, or perform any side effect other than reading the
 *   artifact file.
 */

import { readFileSync } from "node:fs";

import { computeKernelChecksum } from "./artifact.js";
import type { KernelArtifact, ReplayVerdict } from "./types.js";

/**
 * Load a KernelArtifact JSON file and emit a match/mismatch verdict.
 *
 * Throws if the file cannot be read or parsed. A malformed artifact is
 * an error the CLI surfaces; it is NOT silently downgraded to "mismatch".
 */
export function runReplay(artifactPath: string): ReplayVerdict {
  const raw = readFileSync(artifactPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `kernel.replay: artifact is not valid JSON (${artifactPath}): ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  if (!isArtifactShape(parsed)) {
    throw new Error(
      `kernel.replay: artifact is missing required fields {ir, result, checksum} (${artifactPath})`,
    );
  }

  const original_checksum = parsed.checksum;
  const new_checksum      = computeKernelChecksum(parsed.ir, parsed.result);

  return {
    replay:            original_checksum === new_checksum ? "match" : "mismatch",
    original_checksum,
    new_checksum,
  };
}

// ─── Shape guard ─────────────────────────────────────────────────────────────
// Intentionally permissive on the inner shapes — the whole point of replay is
// to detect drift via checksum, so we do not re-validate WorkflowSpec here.

function isArtifactShape(value: unknown): value is KernelArtifact {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["checksum"] === "string" &&
    typeof obj["ir"]       === "object" && obj["ir"]     !== null &&
    typeof obj["result"]   === "object" && obj["result"] !== null
  );
}
