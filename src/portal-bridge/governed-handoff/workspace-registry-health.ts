/**
 * Registry durability health — opaque counts only (INV-WS-1).
 * Auth: portal bearer. Used by ops cert + one-command rehydrate checks.
 */

import { workspaceRegistryDurabilitySnapshot } from "../../governed-decision/workspace-registry.js";
import {
  portalHandoffAuthFailure,
  readPortalBearerToken,
  validatePortalBearerToken,
} from "./auth.js";

export function handlePortalWorkspaceRegistryHealth(
  authorizationHeader: string | undefined,
): { status: number; json: unknown } {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  const snap = workspaceRegistryDurabilitySnapshot();
  return {
    status: 200,
    json: {
      ok: true,
      durable_file_configured: snap.configuredFile,
      durable_file_present: snap.fileExists,
      key_count: snap.keyCount,
      scm_key_count: snap.scmKeyCount,
      installation_bound_count: snap.installationBoundCount,
      message: snap.configuredFile
        ? snap.fileExists
          ? "Registry file configured and present on disk."
          : "Registry file path configured but file not written yet (empty until first provision)."
        : "Set GOVERNED_WORKSPACE_REGISTRY_FILE on a persistent volume (/data) for redeploy durability.",
    },
  };
}
