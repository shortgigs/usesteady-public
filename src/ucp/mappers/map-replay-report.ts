/**
 * Mapper: ReplayReportLike → ReplayReportEnvelope.
 *
 * Maps from a replay verification report to its canonical UCP envelope.
 * This mapper is intentionally defined against a minimal structural type
 * (ReplayReportLike) rather than importing any branded ReplayReport — avoiding
 * circular dependencies while remaining fully type-safe via TypeScript's
 * structural compatibility.
 *
 * ── Mapping rules (field-for-field) ──────────────────────────────────────────
 *
 *   runId             ← report.runId                          (direct copy)
 *   verdict           ← report.verdict                        (direct copy)
 *   checksumValid     ← report.checksumValid                  (direct copy)
 *   artifactChecksum  ← report.artifactChecksum               (direct copy)
 *   nodeCount         ← report.nodeResults.length             (derived)
 *   verifiedCount     ← filter(n => n.verdict === "VERIFIED") (derived)
 *   driftedCount      ← filter(n => n.verdict === "DRIFTED")  (derived)
 *   skippedCount      ← filter(n => n.verdict === "SKIPPED")  (derived)
 *   replayedAtMs      ← report.replayedAtMs                   (direct copy)
 *
 * ── CORRUPTED short-circuit behavior ─────────────────────────────────────────
 *
 *   When report.checksumValid === false (verdict === "CORRUPTED"):
 *     report.nodeResults is [] (verification short-circuits before drift detection)
 *     Therefore: nodeCount = 0, verifiedCount = 0, driftedCount = 0, skippedCount = 0
 *   This is not invented — it follows directly from the source data.
 *   The mapper does NOT special-case CORRUPTED; it maps nodeResults.length as-is.
 *
 * ── Exhaustiveness invariant ──────────────────────────────────────────────────
 *
 *   For all non-CORRUPTED reports:
 *     verifiedCount + driftedCount + skippedCount === nodeCount
 *   This holds because the 3 node-level verdicts are exhaustive and the counts
 *   are derived by independent filters over the same nodeResults array.
 *
 * ── What this mapper does NOT do ─────────────────────────────────────────────
 *
 *   ✗ Infer missing node results
 *   ✗ Collapse states (e.g., merge SKIPPED into DRIFTED)
 *   ✗ Reinterpret replay semantics
 *   ✗ Add summaries beyond the spec
 *   ✗ Derive new conclusions from the verdict
 *
 * The replay envelope is a mirror, not an opinion.
 */

import { createReplayReportEnvelope } from "../envelope.js";
import type { ReplayReportEnvelope, UCPRefs } from "../types.js";

/**
 * Minimal structural type for one node replay result.
 * Consumers pass objects with nodeId, command, verdict, and optional drift fields.
 * We access only .verdict for count derivation.
 */
export type NodeReplayResultLike = {
  readonly verdict: "VERIFIED" | "DRIFTED" | "SKIPPED";
};

/**
 * Minimal structural type matching the relevant fields of ReplayReport.
 * No branded import needed — TypeScript structural typing ensures compatibility.
 */
export type ReplayReportLike = {
  readonly runId:            string;
  readonly artifactChecksum: string;
  readonly checksumValid:    boolean;
  readonly verdict:          "VERIFIED" | "DRIFTED" | "CORRUPTED" | "PARTIAL";
  /** Empty array when verdict === "CORRUPTED" (short-circuit before drift detection). */
  readonly nodeResults:      readonly NodeReplayResultLike[];
  readonly replayedAtMs:     number;
};

/**
 * Map a replay report to its canonical UCP envelope.
 *
 * Pure function — same report → same envelope id (content-addressed).
 * Count fields are derived from nodeResults; no logic is applied beyond counting.
 *
 * @param report  The replay verification outcome (must satisfy ReplayReportLike shape)
 * @param refs    Optional provenance refs:
 *                  refs.parentId = ucp.artifact.v1 ID (the artifact that was verified)
 *                  refs.rootId   = ucp.intent.v1 ID   (originating intent, propagated)
 */
export function mapReplayReportToEnvelope(
  report: ReplayReportLike,
  refs?: UCPRefs,
): ReplayReportEnvelope {
  const nodeCount     = report.nodeResults.length;
  const verifiedCount = report.nodeResults.filter((n) => n.verdict === "VERIFIED").length;
  const driftedCount  = report.nodeResults.filter((n) => n.verdict === "DRIFTED").length;
  const skippedCount  = report.nodeResults.filter((n) => n.verdict === "SKIPPED").length;

  return createReplayReportEnvelope(
    {
      runId:            report.runId,
      verdict:          report.verdict,
      checksumValid:    report.checksumValid,
      artifactChecksum: report.artifactChecksum,
      nodeCount,
      verifiedCount,
      driftedCount,
      skippedCount,
      replayedAtMs:     report.replayedAtMs,
    },
    refs,
  );
}
