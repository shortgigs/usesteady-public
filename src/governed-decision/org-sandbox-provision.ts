/**
 * S1 / S3b — Build opaque org sandbox + SCM registry entries (INV-WS-1).
 *
 * Paths are derived server-side from volumeRoot + org UUID only.
 * SCM product path: GitHub App installationId (mint at execute).
 * REMOVED/REJECTED: per-org GOVERNED_SCM_TOKEN_ORG_* Render env.
 */

import type { WorkspaceRegistryEntry } from "./workspace-registry.js";

export const DEFAULT_ORG_SANDBOX_VOLUME_ROOT = "/data/orgs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function managedOrgWorkspaceKey(organizationUuid: string): string {
  const id = organizationUuid.trim();
  if (!UUID_RE.test(id)) {
    throw new Error("organizationUuid must be a UUID");
  }
  return `ws_org_${id}`;
}

/**
 * Derive sandboxRoot under the persistent volume. Rejects path separators in
 * the UUID and forbids absolute / relative client path injection via volumeRoot
 * traversal — volumeRoot must be absolute and non-empty.
 */
export function buildOrgSandboxRegistryEntry(
  organizationUuid: string,
  volumeRoot: string = DEFAULT_ORG_SANDBOX_VOLUME_ROOT,
): { readonly workspaceKey: string; readonly entry: WorkspaceRegistryEntry } {
  const id = organizationUuid.trim();
  if (!UUID_RE.test(id)) {
    throw new Error("organizationUuid must be a UUID");
  }
  const root = volumeRoot.trim().replace(/[/\\]+$/, "");
  if (root.length === 0) {
    throw new Error("volumeRoot is required");
  }
  if (!root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(root)) {
    throw new Error("volumeRoot must be an absolute path");
  }
  // INV-WS-1: sandboxRoot is always volumeRoot/<uuid> — never a free-form path.
  const sandboxRoot = `${root.replace(/\\/g, "/")}/${id}`;
  return {
    workspaceKey: managedOrgWorkspaceKey(id),
    entry: { sandboxRoot },
  };
}

/**
 * Merge one org sandbox entry into an existing registry object (immutable).
 * Does not accept arbitrary sandboxRoot from callers — uses buildOrgSandboxRegistryEntry.
 */
export function mergeOrgSandboxIntoRegistry(
  existing: Readonly<Record<string, WorkspaceRegistryEntry>>,
  organizationUuid: string,
  volumeRoot: string = DEFAULT_ORG_SANDBOX_VOLUME_ROOT,
): Record<string, WorkspaceRegistryEntry> {
  const { workspaceKey, entry } = buildOrgSandboxRegistryEntry(
    organizationUuid,
    volumeRoot,
  );
  return { ...existing, [workspaceKey]: entry };
}

/** Opaque SCM workspace_key: ws_org_<uuid>_scm */
export function managedOrgScmWorkspaceKey(organizationUuid: string): string {
  return `${managedOrgWorkspaceKey(organizationUuid)}_scm`;
}

export type BuildOrgScmRegistryInput = {
  readonly organizationUuid: string;
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch?: string;
  /** GitHub App installation id — product path. */
  readonly installationId?: string;
  readonly volumeRoot?: string;
};

export type BuildOrgScmRegistryResult = {
  readonly workspaceKey: string;
  readonly entry: WorkspaceRegistryEntry;
  readonly needsAppInstall: boolean;
};

/**
 * S3b — Build SCM registry entry with optional installationId.
 * Paths derived server-side only (INV-WS-1). No tokenEnv / per-org Render env.
 */
export function buildOrgScmRegistryEntry(
  input: BuildOrgScmRegistryInput,
): BuildOrgScmRegistryResult {
  const id = input.organizationUuid.trim();
  if (!UUID_RE.test(id)) {
    throw new Error("organizationUuid must be a UUID");
  }
  const owner = input.owner.trim();
  const repo = input.repo.trim();
  if (owner.length === 0 || repo.length === 0) {
    throw new Error("owner and repo are required");
  }
  if (owner.includes("/") || repo.includes("/")) {
    throw new Error("owner and repo must not contain path separators");
  }
  const volumeRoot = (input.volumeRoot ?? DEFAULT_ORG_SANDBOX_VOLUME_ROOT)
    .trim()
    .replace(/[/\\]+$/, "");
  if (!volumeRoot.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(volumeRoot)) {
    throw new Error("volumeRoot must be an absolute path");
  }

  const installationId =
    typeof input.installationId === "string" && input.installationId.trim().length > 0
      ? input.installationId.trim()
      : undefined;
  if (installationId !== undefined && !/^\d+$/.test(installationId)) {
    throw new Error("installationId must be numeric");
  }

  const baseBranch =
    typeof input.baseBranch === "string" && input.baseBranch.trim().length > 0
      ? input.baseBranch.trim()
      : undefined;

  const sandboxRoot = `${volumeRoot.replace(/\\/g, "/")}/${id}/scm-mirror`;
  return {
    workspaceKey: managedOrgScmWorkspaceKey(id),
    needsAppInstall: installationId === undefined,
    entry: {
      sandboxRoot,
      scm: {
        provider: "github",
        owner,
        repo,
        ...(installationId !== undefined ? { installationId } : {}),
        ...(baseBranch !== undefined ? { baseBranch } : {}),
      },
    },
  };
}
