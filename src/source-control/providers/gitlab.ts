// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * GitLab source-control provider — opens a merge request from a set of file
 * changes using the Commits API (single multi-file commit) + Merge Requests API.
 *
 * No local git checkout is required: the commit is assembled server-side via the
 * REST API, which keeps the actuator dependency-free (no `git`/`glab` binaries)
 * and mirrors the GitHub provider's async-REST model (never execSync).
 *
 * Authority: none. This is transport. The token is operator/server-supplied
 * (never from a request body) and is never logged.
 *
 * Parity with the GitHub provider (same hard-won invariants):
 *   - create-only NO-CLOBBER: a requested path that already exists at the base is
 *     refused, so a commit never silently overwrites a file. The existence check
 *     is pinned to the immutable base COMMIT sha (not the movable branch ref),
 *     so it cannot race a concurrent push (TOCTOU-free): the snapshot we check is
 *     the snapshot we commit onto (start_sha).
 *   - partial commit honesty: only non-conflicting files are committed;
 *     committedPaths reports exactly what landed.
 *   - orphan-branch rollback: if MR creation fails after the branch/commit was
 *     created, the branch is deleted (best-effort) so a retry is clean.
 */

import type {
  OpenPullRequestRequest,
  OpenPullRequestResult,
  ProviderCapabilities,
  SourceControlProvider,
} from "../provider.js";

export type GitLabProviderConfig = {
  readonly token: string;
  /** Full namespace path, e.g. "group/project" or "group/subgroup/project". */
  readonly projectPath: string;
  /** API base; override for self-managed GitLab. Default: https://gitlab.com/api/v4 */
  readonly apiBase?: string;
};

const DEFAULT_API_BASE = "https://gitlab.com/api/v4";

function glHeaders(token: string): Record<string, string> {
  return {
    // Personal/project access tokens use the PRIVATE-TOKEN header on GitLab.
    "PRIVATE-TOKEN": token,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "usesteady/scm-actuator",
  };
}

const CAPABILITIES: ProviderCapabilities = {
  openPullRequest: true,
  // Git cannot represent an empty directory in a commit.
  trackEmptyDirectories: false,
  // Hash-pinned update changes are GitHub-only for now (L4.S2 scope); the
  // bridge pre-fails update ops for this provider via this capability flag.
  updateFiles: false,
  // Hash-pinned rename changes are GitHub-only for now (R2 scope); the
  // bridge pre-fails rename ops for this provider via this capability flag.
  renameFiles: false,
};

export function makeGitLabProvider(config: GitLabProviderConfig): SourceControlProvider {
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  // GitLab addresses a project by URL-encoded full path (slashes -> %2F here,
  // because the whole path is ONE path segment in the REST URL).
  const projectBase = `${apiBase}/projects/${encodeURIComponent(config.projectPath)}`;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${projectBase}${path}`, {
      ...init,
      headers: glHeaders(config.token),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      // Never include the token; only the path + status + provider message.
      throw new Error(`GitLab API ${res.status} ${path}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async function resolveDefaultBranch(): Promise<string> {
    const project = await api<{ default_branch?: string }>("");
    if (typeof project.default_branch !== "string" || project.default_branch.length === 0) {
      throw new Error("GitLab project has no readable default_branch");
    }
    return project.default_branch;
  }

  // No-clobber existence check pinned to an immutable commit sha (TOCTOU-free).
  // 404 -> free to create; 200 -> conflict; other status is a real error.
  async function existsAt(path: string, sha: string): Promise<boolean> {
    const encPath = encodeURIComponent(path); // file path is one segment for GitLab
    const res = await fetch(`${projectBase}/repository/files/${encPath}?ref=${encodeURIComponent(sha)}`, {
      method: "HEAD",
      headers: glHeaders(config.token),
    });
    if (res.status === 404) return false;
    if (res.ok) return true;
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GitLab API ${res.status} /repository/files/${path}: ${text}`);
  }

  // Best-effort branch deletion for rollback. Never throws.
  async function tryDeleteBranch(branch: string): Promise<void> {
    try {
      await fetch(`${projectBase}/repository/branches/${encodeURIComponent(branch)}`, {
        method: "DELETE",
        headers: glHeaders(config.token),
      });
    } catch {
      // swallow: rollback is best-effort
    }
  }

  return {
    id: "gitlab",
    capabilities: CAPABILITIES,

    async openPullRequest(req: OpenPullRequestRequest): Promise<OpenPullRequestResult> {
      if (req.files.length === 0) {
        throw new Error("openPullRequest requires at least one file change");
      }
      // Defense in depth: the bridge already pre-fails update/rename ops for
      // providers whose capability flags are false, so such an entry here is a
      // caller bug. Refuse loudly rather than approximating (a blind overwrite,
      // or a copy-without-delete that nobody approved).
      if (req.files.some((f) => f.kind === "update")) {
        throw new Error("gitlab provider does not support hash-pinned update file changes");
      }
      if (req.files.some((f) => f.kind === "rename")) {
        throw new Error("gitlab provider does not support hash-pinned rename file changes");
      }

      const baseBranch = req.baseBranch ?? (await resolveDefaultBranch());

      // 1. Resolve the base branch to its immutable commit sha.
      const branchInfo = await api<{ commit: { id: string } }>(
        `/repository/branches/${encodeURIComponent(baseBranch)}`,
      );
      const baseSha = branchInfo.commit.id;

      // 2. No-clobber against that exact commit (create-only). Only non-conflicting
      //    files are committed; committedPaths reports what landed.
      const toCommit: { readonly path: string; readonly content: string }[] = [];
      for (const file of req.files) {
        if (file.kind !== "create") continue; // update entries were refused above
        if (!(await existsAt(file.path, baseSha))) toCommit.push(file);
      }
      if (toCommit.length === 0) {
        throw new Error(
          `all ${req.files.length} requested path(s) already exist at base commit ${baseSha}; ` +
            "create-only actuation made no change",
        );
      }

      // 3. Single commit that also creates the head branch, started from the
      //    pinned base sha (start_sha) so the commit is built on the snapshot we
      //    no-clobber-checked. action "create" is itself create-only per file.
      const commit = await api<{ id: string }>("/repository/commits", {
        method: "POST",
        body: JSON.stringify({
          branch: req.headBranch,
          start_sha: baseSha,
          commit_message: req.commitMessage,
          actions: toCommit.map((f) => ({ action: "create", file_path: f.path, content: f.content })),
        }),
      });

      // 4. Merge request. If this fails AFTER the branch/commit exists, roll the
      //    branch back so a retry with the same headBranch is clean.
      let mr: { web_url: string; iid: number };
      try {
        mr = await api<{ web_url: string; iid: number }>("/merge_requests", {
          method: "POST",
          body: JSON.stringify({
            source_branch: req.headBranch,
            target_branch: baseBranch,
            title: req.title,
            description: req.body,
          }),
        });
      } catch (mrErr) {
        await tryDeleteBranch(req.headBranch);
        throw mrErr;
      }

      return {
        url: mr.web_url,
        number: mr.iid,
        headBranch: req.headBranch,
        baseBranch,
        commitSha: commit.id,
        committedPaths: toCommit.map((f) => f.path),
      };
    },
  };
}
