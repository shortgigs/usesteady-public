/**
 * Materialize a sealed capsule onto a disposable projection surface.
 * Absolute paths stay server-local; wire uses capsule_id + projection_key.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  sha256Utf8,
  type Capsule,
  type ProjectionBackend,
  type ProjectionReceipt,
} from "./types.js";

export type MaterializeResult = {
  readonly receipt: ProjectionReceipt;
  /** Server-local only — never a wire field (INV-WS-1). */
  readonly localRoot: string;
};

function newProjectionKey(capsuleId: string): string {
  return `proj_${capsuleId.slice(0, 12)}_${randomBytes(4).toString("hex")}`;
}

/**
 * Write sealed artifacts under root. For sandbox_fs Hybrid D, root is the
 * org sandbox (same root the FS executor uses — idempotent re-run safe).
 */
function writeArtifacts(capsule: Capsule, root: string): Record<string, string> {
  mkdirSync(root, { recursive: true });
  const claimed: Record<string, string> = {};

  for (const dir of capsule.dirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  for (const [relpath, body] of Object.entries(capsule.artifact_bodies)) {
    const dest = join(root, relpath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body, { encoding: "utf8" });
    claimed[relpath] = sha256Utf8(body);
  }
  return claimed;
}

/**
 * Materialize into an ephemeral subdirectory under projectionsRoot.
 */
export function materializeEphemeral(
  capsule: Capsule,
  projectionsRoot: string,
): MaterializeResult {
  mkdirSync(projectionsRoot, { recursive: true });
  const projection_key = newProjectionKey(capsule.capsule_id);
  const localRoot = join(projectionsRoot, projection_key);
  if (existsSync(localRoot)) {
    throw new Error(`projection root already exists: ${projection_key}`);
  }
  const claimed = writeArtifacts(capsule, localRoot);
  return {
    receipt: {
      capsule_id: capsule.capsule_id,
      target: "ephemeral_fs",
      projection_key,
      claimed_root_label: `ephemeral:${projection_key}`,
      claimed_digests: claimed,
    },
    localRoot,
  };
}

/**
 * Materialize into the org managed sandbox (Hybrid D projection backend).
 * workspace_key is opaque wire id; sandboxRoot is server-local only.
 */
export function materializeSandboxFs(
  capsule: Capsule,
  sandboxRoot: string,
  workspaceKey: string,
): MaterializeResult {
  const projection_key = newProjectionKey(capsule.capsule_id);
  const claimed = writeArtifacts(capsule, sandboxRoot);
  return {
    receipt: {
      capsule_id: capsule.capsule_id,
      target: "sandbox_fs",
      projection_key,
      claimed_root_label: `sandbox_fs:${workspaceKey}`,
      claimed_digests: claimed,
    },
    localRoot: sandboxRoot,
  };
}

export function materializeProjection(
  capsule: Capsule,
  backend: ProjectionBackend,
  options: {
    readonly projectionsRoot?: string;
    readonly sandboxRoot?: string;
    readonly workspaceKey?: string;
  },
): MaterializeResult {
  if (backend === "ephemeral_fs") {
    const root = options.projectionsRoot?.trim() ?? "";
    if (!root) throw new Error("projectionsRoot required for ephemeral_fs");
    return materializeEphemeral(capsule, root);
  }
  if (backend === "sandbox_fs") {
    const sandboxRoot = options.sandboxRoot?.trim() ?? "";
    const workspaceKey = options.workspaceKey?.trim() ?? "";
    if (!sandboxRoot) throw new Error("sandboxRoot required for sandbox_fs");
    if (!workspaceKey) throw new Error("workspaceKey required for sandbox_fs");
    return materializeSandboxFs(capsule, sandboxRoot, workspaceKey);
  }
  throw new Error(
    `Projection backend ${backend} is reserved (github_branch deferred). Use sandbox_fs or ephemeral_fs.`,
  );
}
