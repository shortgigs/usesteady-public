/**
 * S1b — Auto-provision managed org sandbox into GOVERNED_WORKSPACE_REGISTRY.
 *
 * INV-WS-1: organization_uuid only on the wire; sandboxRoot derived server-side.
 * No client paths. No SCM tokens here (S3).
 */

import { mkdirSync } from "node:fs";

import {
  buildOrgSandboxRegistryEntry,
  DEFAULT_ORG_SANDBOX_VOLUME_ROOT,
} from "../../governed-decision/org-sandbox-provision.js";
import {
  mergeWorkspaceRegistryEntries,
  resolveWorkspaceEntry,
} from "../../governed-decision/workspace-registry.js";
import {
  portalHandoffAuthFailure,
  readPortalBearerToken,
  validatePortalBearerToken,
} from "./auth.js";

export type WorkspaceProvisionBody = {
  readonly organization_uuid?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function handlePortalWorkspaceProvision(
  authorizationHeader: string | undefined,
  body: WorkspaceProvisionBody,
): { status: number; json: unknown } {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  const orgUuid = readNonEmptyString(body.organization_uuid);
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

  // INV-WS-1: volume root from Core env only — never client-supplied paths.
  const envRoot = (process.env["GOVERNED_ORG_SANDBOX_VOLUME_ROOT"] ?? "").trim();
  const volumeRoot =
    envRoot.length > 0 ? envRoot : DEFAULT_ORG_SANDBOX_VOLUME_ROOT;

  let built: ReturnType<typeof buildOrgSandboxRegistryEntry>;
  try {
    built = buildOrgSandboxRegistryEntry(orgUuid, volumeRoot);
  } catch (err) {
    return {
      status: 400,
      json: {
        ok: false,
        code: "provision_invalid",
        message: err instanceof Error ? err.message : "Invalid provision input.",
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
        message: `Could not create sandbox directory: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const registryFile = (process.env["GOVERNED_WORKSPACE_REGISTRY_FILE"] ?? "").trim();
  const persistFile = registryFile.length > 0;

  try {
    mergeWorkspaceRegistryEntries(
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

  // Never return sandboxRoot to Portal — only opaque key + status.
  return {
    status: 200,
    json: {
      ok: true,
      workspace_key: built.workspaceKey,
      created: !alreadyKnown,
      persisted: persistFile,
      message: persistFile
        ? alreadyKnown
          ? "Registry entry already present; refreshed and volume ensured."
          : "Managed sandbox provisioned into registry file and memory."
        : alreadyKnown
          ? "Registry entry already in memory; volume ensured. Set GOVERNED_WORKSPACE_REGISTRY_FILE for durable auto-sync."
          : "Managed sandbox merged into memory. Set GOVERNED_WORKSPACE_REGISTRY_FILE for durable auto-sync across restarts.",
    },
  };
}
