/**
 * POST /api/portal/gpc/status — lookup sealed capsule + verified projection.
 * Body: { workspace_key, capsule_id } — opaque ids only (INV-WS-1).
 */

import { resolveWorkspaceEntry } from "../../governed-decision/workspace-registry.js";
import {
  capsuleLedgerPathForSandbox,
  lookupGpcStatus,
} from "../../governed-decision/gpc/index.js";
import {
  portalHandoffAuthFailure,
  portalHandoffUnavailable,
  readPortalBearerToken,
  validatePortalBearerToken,
} from "./auth.js";
import { getPortalGovernedHandoffDeps } from "./handlers.js";

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function handlePortalGpcStatus(
  authorizationHeader: string | undefined,
  body: unknown,
): { status: number; json: unknown } {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  if (getPortalGovernedHandoffDeps() === null) {
    const u = portalHandoffUnavailable(
      "Governed handoff is not configured on this Core instance (GOVERNED_PORTAL=1 required).",
    );
    return { status: u.status, json: u.body };
  }

  const raw =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const workspaceKey = readNonEmptyString(raw["workspace_key"]);
  const capsuleId = readNonEmptyString(raw["capsule_id"]);
  if (workspaceKey === null || capsuleId === null) {
    return {
      status: 400,
      json: {
        ok: false,
        code: "capsule_lookup_required",
        message: "workspace_key and capsule_id are required (opaque ids only).",
      },
    };
  }

  const entry = resolveWorkspaceEntry(workspaceKey);
  if (entry === null) {
    return {
      status: 422,
      json: {
        ok: false,
        code: "unknown_workspace_key",
        message: `Unknown workspace_key "${workspaceKey}".`,
      },
    };
  }

  const ledgerPath = capsuleLedgerPathForSandbox(entry.sandboxRoot);
  const status = lookupGpcStatus({ ledgerPath, capsuleId });

  return {
    status: 200,
    json: {
      ok: true,
      // Lookup provenance owns workspace_key, including null when absent.
      ...status,
    },
  };
}
