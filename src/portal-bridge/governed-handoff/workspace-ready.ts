/**
 * S2 — Portal probe: is workspace_key known to GOVERNED_WORKSPACE_REGISTRY?
 *
 * Read-only. No paths or secrets returned (INV-WS-1 / Surface Authority).
 * Auth: same portal bearer as governed-handoff.
 */

import { resolveWorkspaceEntry } from "../../governed-decision/workspace-registry.js";
import {
  portalHandoffAuthFailure,
  readPortalBearerToken,
  validatePortalBearerToken,
} from "./auth.js";

export type WorkspaceReadyBody = {
  readonly workspace_key?: unknown;
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * POST body `{ workspace_key }` → `{ ok, known, code? }`.
 * Never returns sandboxRoot or SCM coordinates.
 */
export function handlePortalWorkspaceReady(
  authorizationHeader: string | undefined,
  body: WorkspaceReadyBody,
): { status: number; json: unknown } {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  const workspaceKey = readNonEmptyString(body.workspace_key);
  if (workspaceKey === null) {
    return {
      status: 400,
      json: {
        ok: false,
        known: false,
        code: "workspace_key_required",
        message: "workspace_key must be a non-empty string.",
      },
    };
  }

  const entry = resolveWorkspaceEntry(workspaceKey);
  if (entry === null) {
    return {
      status: 200,
      json: {
        ok: true,
        known: false,
        code: "unknown_workspace_key",
        message: `Unknown workspace_key "${workspaceKey}".`,
      },
    };
  }

  const hasScm = entry.scm !== undefined;
  const installationBound =
    typeof entry.scm?.installationId === "string" &&
    entry.scm.installationId.trim().length > 0;

  return {
    status: 200,
    json: {
      ok: true,
      known: true,
      has_scm: hasScm,
      // Product honesty for Portal Execution space — never returns owner/repo
      // coordinates (INV-WS-1); Portal already stores those in portal_workspaces.
      installation_bound: installationBound,
    },
  };
}
