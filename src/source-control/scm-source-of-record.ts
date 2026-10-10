/**
 * SCM source-of-record sensor (USESTEADY_PORTAL_HANDOFF_CERT_V1).
 *
 * Portal scm-github handoffs actuate via the Git Data API with no local git
 * checkout. The Decision Basis git sensor therefore cannot establish SoR at the
 * sandbox mirror. This module reads HEAD from GitHub (same credentials the
 * executor uses) and returns a gauge-tagged section the basis port can inject
 * verbatim — never fabricated: failure → unavailable with a reason.
 *
 * Authority: none. Capture only. Token is never logged.
 */

import type { DecisionSection } from "../governed-decision/types.js";

export type GithubSourceOfRecordInput = {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly apiBase?: string;
  /** When omitted, the repo default_branch is resolved first. */
  readonly baseBranch?: string;
};

function encodeRefPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "usesteady/scm-source-of-record",
  };
}

/**
 * Sense repository provenance for a GitHub repo via REST (HEAD of base branch).
 * Never throws — degrades to unavailable.
 */
export async function senseGithubSourceOfRecord(
  input: GithubSourceOfRecordInput,
): Promise<DecisionSection<unknown>> {
  const token = input.token.trim();
  const owner = input.owner.trim();
  const repo = input.repo.trim();
  if (token.length === 0 || owner.length === 0 || repo.length === 0) {
    return {
      status: "unavailable",
      reason: "scm source-of-record requires token, owner, and repo",
    };
  }

  const apiBase = (input.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  try {
    const u = new URL(apiBase);
    if (u.protocol !== "https:") {
      return {
        status: "unavailable",
        reason: "scm source-of-record requires https apiBase",
      };
    }
  } catch {
    return {
      status: "unavailable",
      reason: "scm source-of-record apiBase is not a valid URL",
    };
  }

  const repoBase = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = ghHeaders(token);

  try {
    let branch =
      typeof input.baseBranch === "string" && input.baseBranch.trim().length > 0
        ? input.baseBranch.trim()
        : "";
    if (branch.length === 0) {
      const repoRes = await fetch(repoBase, { headers });
      if (!repoRes.ok) {
        const text = await repoRes.text().catch(() => repoRes.statusText);
        return {
          status: "unavailable",
          reason: `scm source-of-record: could not read repo (${repoRes.status}): ${text}`,
        };
      }
      const repoJson = (await repoRes.json()) as { default_branch?: unknown };
      if (typeof repoJson.default_branch !== "string" || repoJson.default_branch.trim().length === 0) {
        return {
          status: "unavailable",
          reason: "scm source-of-record: repo has no readable default_branch",
        };
      }
      branch = repoJson.default_branch.trim();
    }

    const refRes = await fetch(`${repoBase}/git/refs/heads/${encodeRefPath(branch)}`, {
      headers,
    });
    if (!refRes.ok) {
      const text = await refRes.text().catch(() => refRes.statusText);
      return {
        status: "unavailable",
        reason: `scm source-of-record: could not read HEAD of ${branch} (${refRes.status}): ${text}`,
      };
    }
    const refJson = (await refRes.json()) as { object?: { sha?: unknown } };
    const commit =
      typeof refJson.object?.sha === "string" && /^[0-9a-f]{40}$/i.test(refJson.object.sha)
        ? refJson.object.sha.toLowerCase()
        : null;
    if (commit === null) {
      return {
        status: "unavailable",
        reason: "scm source-of-record: HEAD sha missing or malformed",
      };
    }

    return {
      status: "connected",
      value: {
        identity: `github:${owner}/${repo}`,
        commit,
        dirty: null,
        branch,
        sensor: "github_api",
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      reason: `scm source-of-record failed unexpectedly: ${message}`,
    };
  }
}
