/**
 * W-W1 / W-W3 — Resolve server-bound handoff deps for a workspace_key.
 * INV-WS-1: paths and SCM coordinates come from registry only.
 *
 * SCM product path (S3b): GitHub App installation_id → mint token at actuate.
 * REMOVED/REJECTED: per-org GOVERNED_SCM_TOKEN_ORG_* Render env.
 */

import type { GovernedApiDeps } from "../../governed-decision/http.js";
import type { DecisionSection } from "../../governed-decision/types.js";
import type { DeterministicExecutor } from "../../governed-decision/stages/execution.js";
import type { RealityProbe } from "../../governed-decision/stages/observation.js";
import { makeSandboxedFsExecutor } from "../../governed-decision/stages/fs-executor.js";
import { makeFsRealityProbe } from "../../governed-decision/stages/fs-reality-probe.js";
import {
  resolveWorkspaceEntry,
  type WorkspaceRegistryEntry,
} from "../../governed-decision/workspace-registry.js";
import {
  githubAppConfigured,
  mintInstallationAccessToken,
} from "../../source-control/github-app-auth.js";
import { makeGitHubProvider } from "../../source-control/providers/github.js";
import { makeScmExecutor } from "../../source-control/scm-executor.js";
import { makeScmRealityProbe } from "../../source-control/scm-reality-probe.js";
import { senseGithubSourceOfRecord } from "../../source-control/scm-source-of-record.js";

export type HandoffDepsResolution =
  | { ok: true; deps: GovernedApiDeps; entry: WorkspaceRegistryEntry | null }
  | { ok: false; status: number; code: string; message: string };

function readExecuteToken(): string {
  return (process.env["GOVERNED_EXECUTE_TOKEN"] ?? "").trim();
}

/**
 * Resolve SCM token for actuation:
 * 1) GitHub App installation_id (product path)
 * 2) Shared dogfood GOVERNED_SCM_TOKEN only (not per-org env)
 */
async function resolveScmAccessToken(
  entry: WorkspaceRegistryEntry,
): Promise<string | null> {
  const installationId = entry.scm?.installationId?.trim();
  if (installationId && githubAppConfigured()) {
    try {
      const minted = await mintInstallationAccessToken(installationId, {
        ...(entry.scm?.apiBase ? { apiBase: entry.scm.apiBase } : {}),
      });
      return minted.token;
    } catch {
      return null;
    }
  }
  // Shared platform dogfood token only — never GOVERNED_SCM_TOKEN_ORG_*.
  const global = (process.env["GOVERNED_SCM_TOKEN"] ?? "").trim();
  return global.length > 0 ? global : null;
}

/** Readiness: App install bound, or shared dogfood token for non-managed keys. */
export function scmActuationReady(entry: WorkspaceRegistryEntry): boolean {
  const installationId = entry.scm?.installationId?.trim();
  if (installationId && installationId.length > 0) {
    return githubAppConfigured();
  }
  return (process.env["GOVERNED_SCM_TOKEN"] ?? "").trim().length > 0;
}

async function wireScmPair(entry: WorkspaceRegistryEntry): Promise<{
  executor: DeterministicExecutor;
  realityProbe: RealityProbe;
  sourceOfRecord: DecisionSection<unknown>;
} | null> {
  const scm = entry.scm;
  if (!scm || scm.provider !== "github") return null;
  const token = await resolveScmAccessToken(entry);
  if (!token) return null;

  let apiBase = scm.apiBase ?? "https://api.github.com";
  if (apiBase.length > 0) {
    try {
      const u = new URL(apiBase);
      if (u.protocol !== "https:") return null;
    } catch {
      return null;
    }
  }

  const provider = makeGitHubProvider({
    token,
    owner: scm.owner,
    repo: scm.repo,
    apiBase,
  });
  // USESTEADY_PORTAL_HANDOFF_CERT_V1: scm sandboxes are not local git checkouts.
  // Sense HEAD via GitHub so Truth Arbitration can grade source_of_record.
  const sourceOfRecord = await senseGithubSourceOfRecord({
    token,
    owner: scm.owner,
    repo: scm.repo,
    apiBase,
    ...(scm.baseBranch ? { baseBranch: scm.baseBranch } : {}),
  });
  return {
    executor: makeScmExecutor({
      provider,
      ...(scm.baseBranch ? { baseBranch: scm.baseBranch } : {}),
    }),
    realityProbe: makeScmRealityProbe({
      token,
      owner: scm.owner,
      repo: scm.repo,
      apiBase,
    }),
    sourceOfRecord,
  };
}

function wireFsPair(sandboxRoot: string): {
  executor: DeterministicExecutor;
  realityProbe: RealityProbe;
} {
  return {
    executor: makeSandboxedFsExecutor(sandboxRoot),
    realityProbe: makeFsRealityProbe(sandboxRoot),
  };
}

/**
 * Merge base wired deps with workspace-specific sandboxRoot and optional SCM
 * actuation when GOVERNED_EXECUTE=1 and token is configured.
 */
export async function resolveHandoffDepsForKey(
  baseDeps: GovernedApiDeps,
  workspaceKey: string | null | undefined,
  options: { actuate: boolean },
): Promise<HandoffDepsResolution> {
  const key = typeof workspaceKey === "string" ? workspaceKey.trim() : "";
  const entry = key.length > 0 ? resolveWorkspaceEntry(key) : null;

  if (key.length > 0 && entry === null) {
    return {
      ok: false,
      status: 422,
      code: "unknown_workspace_key",
      message: `Unknown workspace_key "${key}".`,
    };
  }

  const globalRoot = (process.env["GOVERNED_WORKSPACE"] ?? "").trim();
  const basisWorkspace =
    entry?.sandboxRoot ?? (globalRoot.length > 0 ? globalRoot : null);

  let deps: GovernedApiDeps = {
    ...baseDeps,
    ...(basisWorkspace ? { basisWorkspace } : {}),
  };

  if (!options.actuate || process.env["GOVERNED_EXECUTE"] !== "1") {
    return { ok: true, deps, entry };
  }

  if (readExecuteToken().length === 0) {
    return { ok: true, deps, entry };
  }

  if (entry?.scm) {
    const wired = await wireScmPair(entry);
    if (wired !== null) {
      deps = {
        ...deps,
        executor: wired.executor,
        realityProbe: wired.realityProbe,
        deliveryExecutorKind: `scm-${entry.scm.provider}`,
        // Prefer API SoR even when unavailable (honest reason) over cwd git.
        basisSourceOfRecord: wired.sourceOfRecord,
      };
      return { ok: true, deps, entry };
    }
    return {
      ok: false,
      status: 500,
      code: "scm_wiring_failed",
      message:
        "Workspace is configured for SCM but GitHub App installation token could not be minted. Complete App install (not per-org Render env).",
    };
  }

  if (basisWorkspace) {
    const wired = wireFsPair(basisWorkspace);
    deps = {
      ...deps,
      executor: wired.executor,
      realityProbe: wired.realityProbe,
      deliveryExecutorKind: "fs",
    };
  }

  return { ok: true, deps, entry };
}
