/**
 * S3b — Provision org SCM workspace into GOVERNED_WORKSPACE_REGISTRY.
 *
 * Wire: organization_uuid + owner/repo + optional installation_id.
 * Product path: GitHub App install → installation_id → mint at execute.
 * REMOVED/REJECTED: token_env / GOVERNED_SCM_TOKEN_ORG_* per-org Render paste.
 */

import { mkdirSync } from "node:fs";

import {
  buildOrgScmRegistryEntry,
  DEFAULT_ORG_SANDBOX_VOLUME_ROOT,
} from "../../governed-decision/org-sandbox-provision.js";
import {
  mergeWorkspaceRegistryEntries,
  resolveWorkspaceEntry,
} from "../../governed-decision/workspace-registry.js";
import {
  githubAppConfigured,
  githubAppInstallUrl,
} from "../../source-control/github-app-auth.js";
import {
  portalHandoffAuthFailure,
  readPortalBearerToken,
  validatePortalBearerToken,
} from "./auth.js";

export type WorkspaceScmProvisionBody = {
  readonly organization_uuid?: unknown;
  readonly owner?: unknown;
  readonly repo?: unknown;
  readonly base_branch?: unknown;
  readonly installation_id?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInstallationId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const s = readNonEmptyString(value);
  if (s === null) return null;
  return /^\d+$/.test(s) ? s : null;
}

export function handlePortalWorkspaceScmProvision(
  authorizationHeader: string | undefined,
  body: WorkspaceScmProvisionBody,
): { status: number; json: unknown } {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  const orgUuid = readNonEmptyString(body.organization_uuid);
  const owner = readNonEmptyString(body.owner);
  const repo = readNonEmptyString(body.repo);
  if (orgUuid === null || !UUID_RE.test(orgUuid)) {
    return {
      status: 400,
      json: {
        ok: false,
        code: "organization_uuid_required",
        message: "organization_uuid must be a UUID.",
      },
    };
  }
  if (owner === null || repo === null) {
    return {
      status: 400,
      json: {
        ok: false,
        code: "scm_coords_required",
        message: "owner and repo are required.",
      },
    };
  }

  const installationId = readInstallationId(body.installation_id);
  if (
    body.installation_id !== undefined &&
    body.installation_id !== null &&
    String(body.installation_id).trim().length > 0 &&
    installationId === null
  ) {
    return {
      status: 400,
      json: {
        ok: false,
        code: "installation_id_invalid",
        message: "installation_id must be numeric.",
      },
    };
  }

  const baseBranch = readNonEmptyString(body.base_branch);
  const envRoot = (process.env["GOVERNED_ORG_SANDBOX_VOLUME_ROOT"] ?? "").trim();
  const volumeRoot =
    envRoot.length > 0 ? envRoot : DEFAULT_ORG_SANDBOX_VOLUME_ROOT;

  let built: ReturnType<typeof buildOrgScmRegistryEntry>;
  try {
    built = buildOrgScmRegistryEntry({
      organizationUuid: orgUuid,
      owner,
      repo,
      volumeRoot,
      ...(baseBranch !== null ? { baseBranch } : {}),
      ...(installationId !== null ? { installationId } : {}),
    });
  } catch (err) {
    return {
      status: 400,
      json: {
        ok: false,
        code: "scm_provision_invalid",
        message: err instanceof Error ? err.message : "Invalid SCM provision input.",
      },
    };
  }

  const existing = resolveWorkspaceEntry(built.workspaceKey);
  const alreadyKnown = existing !== null;

  try {
    mkdirSync(built.entry.sandboxRoot, { recursive: true });
  } catch (err) {
    return {
      status: 500,
      json: {
        ok: false,
        code: "mkdir_failed",
        message: `Could not create scm-mirror directory: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const registryFile = (process.env["GOVERNED_WORKSPACE_REGISTRY_FILE"] ?? "").trim();
  const persistFile = registryFile.length > 0;

  let merged;
  try {
    merged = mergeWorkspaceRegistryEntries(
      { [built.workspaceKey]: built.entry },
      { persistFile },
    );
  } catch (err) {
    return {
      status: 500,
      json: {
        ok: false,
        code: "registry_persist_failed",
        message: err instanceof Error ? err.message : "Registry merge failed.",
      },
    };
  }

  const boundAfter =
    typeof merged[built.workspaceKey]?.scm?.installationId === "string" &&
    merged[built.workspaceKey]!.scm!.installationId!.trim().length > 0;

  const appReady = githubAppConfigured();
  const installUrl = githubAppInstallUrl(orgUuid);
  // Post-merge reality: preserved installationId means no re-install required.
  const needsAppInstall = !boundAfter;

  return {
    status: 200,
    json: {
      ok: true,
      workspace_key: built.workspaceKey,
      created: !alreadyKnown,
      persisted: persistFile,
      needs_app_install: needsAppInstall,
      app_configured: appReady,
      installation_bound: boundAfter,
      ...(installUrl !== null ? { install_url: installUrl } : {}),
      eligibility:
        "SCM workspaces cannot create empty directories (create_dir). Prefer file creates/updates; Path A FS stays on managed sandbox.",
      message: needsAppInstall
        ? "SCM registry entry provisioned. Complete GitHub App install (one platform App — not per-org Render env). Bind returns installation_id."
        : alreadyKnown
          ? "SCM registry entry refreshed with GitHub App installation."
          : "SCM registry entry provisioned with GitHub App installation. Tokens mint at execute time.",
    },
  };
}
