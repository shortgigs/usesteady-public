/**
 * Kernel v1 — local-only artifact persistence.
 *
 * Target: `{storeDir}/replay/<checksum>.artifact.json`.
 *
 *   - Content-addressed by the artifact's own checksum, so identical runs
 *     dedupe naturally (same filename = same content).
 *   - No timestamps in the filename — determinism rule.
 *   - No DB. No cloud. No index. Write-and-forget.
 *
 * Callers MUST invoke this from inside a try/catch (see src/shell/cli/main.ts
 * finalize block). Any I/O failure here is non-fatal — a lost replay artifact
 * is strictly preferable to a crashed run.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join }                     from "node:path";

import type { KernelArtifact } from "./types.js";

export const KERNEL_REPLAY_DIRNAME = "replay";

/**
 * Write a KernelArtifact to {storeDir}/replay/<checksum>.artifact.json.
 *
 * Returns the absolute path written on success.
 * Throws on I/O failure — the caller decides whether to swallow.
 */
export function persistKernelArtifact(
  artifact: KernelArtifact,
  storeDir: string,
): string {
  const replayDir = join(storeDir, KERNEL_REPLAY_DIRNAME);
  mkdirSync(replayDir, { recursive: true });

  const filename     = `${artifact.checksum}.artifact.json`;
  const artifactPath = join(replayDir, filename);

  writeFileSync(artifactPath, JSON.stringify(artifact), "utf8");

  return artifactPath;
}
