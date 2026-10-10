/**
 * Independent reality probe for a projected capsule.
 * Re-hashes disk; does NOT trust ProjectionReceipt self-report alone.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Capsule, RealityProbeResult } from "./types.js";

function sha256Bytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(full);
    }
  }
  if (existsSync(root)) walk(root);
  return out;
}

/**
 * Observe digests on disk and compare to the sealed capsule.
 * Extra files outside the sealed set fail closed only when
 * `strictExtraFiles` is true (ephemeral projections). For sandbox_fs,
 * the org sandbox may hold prior work — only sealed paths are checked.
 */
export function probeProjection(
  capsule: Capsule,
  localRoot: string,
  projectionKey: string,
  options: { readonly strictExtraFiles?: boolean } = {},
): RealityProbeResult {
  const observed: Record<string, string> = {};
  const mismatches: string[] = [];

  for (const dir of capsule.dirs) {
    const path = join(localRoot, dir);
    if (!existsSync(path) || !lstatSync(path).isDirectory()) {
      mismatches.push(`dir:${dir}`);
    }
  }

  for (const [relpath, expected] of Object.entries(capsule.artifact_digests)) {
    const path = join(localRoot, relpath);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      mismatches.push(relpath);
      continue;
    }
    const digest = sha256Bytes(readFileSync(path));
    observed[relpath] = digest;
    if (digest !== expected) {
      mismatches.push(relpath);
    }
  }

  if (options.strictExtraFiles === true) {
    for (const full of walkFiles(localRoot)) {
      const rel = relative(localRoot, full).replace(/\\/g, "/");
      if (!(rel in capsule.artifact_digests)) {
        mismatches.push(`+${rel}`);
        observed[rel] = sha256Bytes(readFileSync(full));
      }
    }
  }

  return {
    capsule_id: capsule.capsule_id,
    projection_key: projectionKey,
    observed_digests: observed,
    matches_capsule: mismatches.length === 0,
    mismatch_paths: mismatches,
  };
}
