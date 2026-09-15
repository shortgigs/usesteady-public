/**
 * Mapper: ArtifactLike → ArtifactEnvelope.
 *
 * Maps from a finalized run artifact to its canonical UCP envelope.
 * This mapper is intentionally defined against a minimal structural type
 * (ArtifactLike) rather than importing any branded FinalizedArtifact —
 * avoiding circular dependencies while remaining fully type-safe via
 * TypeScript's structural compatibility.
 *
 * ── Mapping rules (field-for-field) ──────────────────────────────────────────
 *
 *   runId         ← artifact.runId                     (direct copy)
 *   goal          ← artifact.goal                      (direct copy)
 *   status        ← artifact.status                    (direct copy)
 *   checksum      ← artifact.checksum                  (direct copy — NEVER recomputed)
 *   graphChecksum ← artifact.graph.checksum             (direct copy)
 *   nodeCount     ← artifact.nodes.length              (count only)
 *   startedAtMs   ← artifact.startedAtMs               (direct copy)
 *   completedAtMs ← artifact.completedAtMs             (direct copy)
 *
 * ── What this mapper does NOT do ─────────────────────────────────────────────
 *
 *   ✗ Recompute artifact checksum
 *   ✗ Copy nodes[], trace[], lineage, or explainSummary
 *   ✗ Interpret or reinterpret any field
 *   ✗ Add renderer-facing concerns
 */

import { createArtifactEnvelope } from "../envelope.js";
import type { ArtifactEnvelope, UCPRefs } from "../types.js";

/**
 * Minimal structural type matching the relevant fields of FinalizedArtifact.
 * No branded import needed — TypeScript structural typing ensures compatibility.
 */
export type ArtifactLike = {
  readonly runId:         string;
  readonly goal:          string;
  readonly status:        "COMPLETED" | "FAILED" | "DENIED";
  /** SHA-256 of the sealed artifact — copied as-is, never recomputed. */
  readonly checksum:      string;
  readonly graph:         { readonly checksum: string };
  /** Only .length is accessed — the full node list is not mapped. */
  readonly nodes:         readonly unknown[];
  readonly startedAtMs:   number;
  readonly completedAtMs: number;
};

/**
 * Map a finalized artifact to its canonical UCP envelope.
 *
 * Pure function — same artifact → same envelope id (content-addressed).
 *
 * @param artifact  The finalized run artifact (must satisfy ArtifactLike shape)
 * @param refs      Optional provenance refs:
 *                    refs.rootId   = ucp.intent.v1 ID (closes provenance chain)
 *                    refs.parentId = ucp.response.v1 ID (immediate predecessor)
 */
export function mapArtifactToEnvelope(
  artifact: ArtifactLike,
  refs?: UCPRefs,
): ArtifactEnvelope {
  return createArtifactEnvelope(
    {
      runId:         artifact.runId,
      goal:          artifact.goal,
      status:        artifact.status,
      checksum:      artifact.checksum,     // copied — NEVER recomputed
      graphChecksum: artifact.graph.checksum,
      nodeCount:     artifact.nodes.length,
      startedAtMs:   artifact.startedAtMs,
      completedAtMs: artifact.completedAtMs,
    },
    refs,
  );
}
