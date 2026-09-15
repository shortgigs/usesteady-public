// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * GitHub source-control provider — opens a pull request from a set of file
 * changes using the Git Data API (blobs -> tree -> commit -> ref -> PR).
 *
 * No local git checkout is required: the commit is assembled server-side via the
 * REST API, which keeps the actuator dependency-free (no `git`/`gh` binaries) and
 * matches how editor integrations talk to GitHub (async REST, never execSync).
 *
 * Authority: none. This is transport. The token is operator/server-supplied
 * (never from a request body) and is never logged.
 */

import { createHash } from "node:crypto";
import type {
  OpenPullRequestRequest,
  OpenPullRequestResult,
  ProviderCapabilities,
  SourceControlProvider,
} from "../provider.js";

export type GitHubProviderConfig = {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  /** API base; override for GitHub Enterprise Server. Default: https://api.github.com */
  readonly apiBase?: string;
};

const DEFAULT_API_BASE = "https://api.github.com";

/**
 * Encode a git ref/branch name for use in a URL path while preserving its
 * STRUCTURAL slashes. `GET /git/ref/heads/<branch>` expects `heads/<branch>` to
 * carry real path separators, so a slashed branch (e.g. `release/v1`) must have
 * each segment escaped individually rather than the whole name through
 * encodeURIComponent (which would turn `/` into `%2F` and 404).
 */
function encodeRefPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "usesteady/scm-actuator",
  };
}

const CAPABILITIES: ProviderCapabilities = {
  openPullRequest: true,
  // Git cannot represent an empty directory in a commit.
  trackEmptyDirectories: false,
  // L4.S2: hash-pinned update file changes are implemented for GitHub.
  updateFiles: true,
  // R2: hash-pinned rename file changes are implemented for GitHub.
  renameFiles: true,
};

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function makeGitHubProvider(config: GitHubProviderConfig): SourceControlProvider {
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const repoBase = `${apiBase}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${repoBase}${path}`, {
      ...init,
      headers: { ...ghHeaders(config.token), ...(init.headers as Record<string, string> | undefined ?? {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      // Never include the token; only the path + status + provider message.
      throw new Error(`GitHub API ${res.status} ${path}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // Best-effort ref deletion for rollback. Never throws (cleanup must not mask
  // the original error). DELETE returns 204 with no body, so we do not parse JSON.
  async function tryDeleteRef(headBranch: string): Promise<void> {
    try {
      await fetch(`${repoBase}/git/refs/heads/${encodeRefPath(headBranch)}`, {
        method: "DELETE",
        headers: ghHeaders(config.token),
      });
    } catch {
      // swallow: rollback is best-effort
    }
  }

  async function resolveDefaultBranch(): Promise<string> {
    const repo = await api<{ default_branch?: string }>("");
    if (typeof repo.default_branch !== "string" || repo.default_branch.length === 0) {
      throw new Error("GitHub repo has no readable default_branch");
    }
    return repo.default_branch;
  }

  // No-clobber existence check: does `path` already exist at `ref`? Callers pass
  // the immutable base COMMIT sha (not a branch ref) so the check cannot race a
  // concurrent push (TOCTOU-free). Enforces the create-only contract (mirrors the
  // FS executor's O_EXCL), so a create_file op never silently overwrites an
  // existing file via a base_tree merge. 404 -> free to create; 200 -> conflict;
  // any other status is a real error.
  async function existsOnBase(path: string, ref: string): Promise<boolean> {
    const encPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${repoBase}/contents/${encPath}?ref=${encodeRefPath(ref)}`, {
      headers: ghHeaders(config.token),
    });
    if (res.status === 404) return false;
    if (res.ok) return true;
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GitHub API ${res.status} /contents/${path}: ${text}`);
  }

  // Read the exact UTF-8 content of `path` at an immutable commit sha, or null
  // when absent. Uses the RAW media type: the JSON Contents API returns empty
  // content with encoding:none for 1-100 MB files, which would make the hash
  // gate below falsely refuse a legitimate update (same trap the reality probe
  // avoids). Pinned to the base COMMIT sha, so the content we hash-check is the
  // content the commit is built on (TOCTOU-free).
  async function readAtBase(path: string, ref: string): Promise<string | null> {
    const encPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${repoBase}/contents/${encPath}?ref=${encodeRefPath(ref)}`, {
      headers: { ...ghHeaders(config.token), Accept: "application/vnd.github.raw" },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`GitHub API ${res.status} /contents/${path}: ${text}`);
    }
    return res.text();
  }

  return {
    id: "github",
    capabilities: CAPABILITIES,

    async openPullRequest(req: OpenPullRequestRequest): Promise<OpenPullRequestResult> {
      if (req.files.length === 0) {
        throw new Error("openPullRequest requires at least one file change");
      }

      const baseBranch = req.baseBranch ?? (await resolveDefaultBranch());

      // 1. Base ref -> base commit sha. Structural slashes preserved for
      //    slashed branch names (e.g. release/v1).
      const baseRef = await api<{ object: { sha: string } }>(
        `/git/ref/heads/${encodeRefPath(baseBranch)}`,
      );
      const baseSha = baseRef.object.sha;

      // 2. Base commit -> base tree sha. The new commit is built on THIS tree.
      const baseCommit = await api<{ tree: { sha: string } }>(`/git/commits/${baseSha}`);
      const baseTreeSha = baseCommit.tree.sha;

      // 3. Per-file admission, pinned to the EXACT base commit we are building
      //    on (`baseSha`, not the movable branch ref — TOCTOU-free: the snapshot
      //    we check is the snapshot we commit onto).
      //
      //    create — no-clobber: refuse a path that already exists at the base
      //    (create_file is create-only; the FS executor uses O_EXCL; a base_tree
      //    merge would otherwise silently overwrite).
      //
      //    update (L4.S2) — the inverse gate plus the approval anchor: the path
      //    MUST exist at the base, and its content there must hash to the
      //    approved `expectedPriorSha256` — the pre-state the human actually
      //    reviewed. A base that drifted since approval is refused, never
      //    silently re-anchored. The post content is derived deterministically
      //    from the PINNED prior content (every `find` occurrence replaced) and
      //    must hash to `expectedPostSha256` (defense in depth). A base already
      //    at the post-state has no change to propose — skipped honestly, not
      //    committed as an empty diff.
      //
      //    rename (R2) — both halves gated at the base: the SOURCE must exist
      //    and hash to the approved `expectedPriorSha256` (the content the
      //    human actually reviewed; a source that drifted since approval is
      //    refused, never silently re-anchored), and the DESTINATION must be
      //    free (no-clobber: a rename never overwrites content nobody
      //    approved). The commit then carries the delete-source + write-
      //    destination pair atomically in one tree. A base where the source is
      //    already absent and the destination already holds the pinned content
      //    reflects the approved rename — no diff to propose, skipped honestly
      //    (same reasoning as the update post-state case above).
      //
      //    Only admitted files are committed; `committedPaths` + `skippedPaths`
      //    report exactly what landed and why the rest did not, so the bridge
      //    marks each refused op failed with the real reason. A rename is
      //    identified in both lists by its SOURCE path.
      const writes: { readonly path: string; readonly content: string }[] = [];
      const deletions: string[] = [];
      const committedPaths: string[] = [];
      const skippedPaths: { readonly path: string; readonly reason: string }[] = [];
      for (const file of req.files) {
        if (file.kind === "rename") {
          const prior = await readAtBase(file.path, baseSha);
          if (prior === null) {
            const dest = await readAtBase(file.toPath, baseSha);
            if (dest !== null && sha256Hex(dest) === file.expectedPriorSha256) {
              skippedPaths.push({
                path: file.path,
                reason: "base already reflects the approved rename; no change to propose",
              });
            } else {
              skippedPaths.push({
                path: file.path,
                reason: "source file does not exist at the base commit; rename not actuated",
              });
            }
            continue;
          }
          if (sha256Hex(prior) !== file.expectedPriorSha256) {
            skippedPaths.push({
              path: file.path,
              reason: "source content changed since approval; rename not actuated",
            });
            continue;
          }
          if (await existsOnBase(file.toPath, baseSha)) {
            skippedPaths.push({
              path: file.path,
              reason: "destination path already exists on the base branch; rename not actuated",
            });
            continue;
          }
          writes.push({ path: file.toPath, content: prior });
          deletions.push(file.path);
          committedPaths.push(file.path);
          continue;
        }
        if (file.kind === "update") {
          const prior = await readAtBase(file.path, baseSha);
          if (prior === null) {
            skippedPaths.push({
              path: file.path,
              reason: "file does not exist at the base commit; must-exist update not actuated",
            });
            continue;
          }
          const priorHash = sha256Hex(prior);
          if (priorHash === file.expectedPostSha256) {
            // INTENTIONAL divergence from the FS executor's idempotent-`ran`
            // treatment of this case. The FS actuation product is the file
            // mutation itself, so post-state-already-satisfied honestly IS the
            // approved outcome. The SCM actuation product is a PR — an empty
            // diff cannot be proposed, and reporting the op `ran` would send
            // the independent reality probe to the derived head branch, which
            // was never created, producing a FALSE disagree. Retry-after-
            // persistence-failure idempotency is already fail-closed for SCM
            // by design: the content-addressed branch collides (422) on
            // re-actuation. So this is a skip with an honest reason, not a ran.
            skippedPaths.push({
              path: file.path,
              reason: "base content already matches the approved post-state; no change to propose",
            });
            continue;
          }
          if (priorHash !== file.expectedPriorSha256) {
            skippedPaths.push({
              path: file.path,
              reason: "file content changed since approval; update not actuated",
            });
            continue;
          }
          const post = file.find.length > 0 ? prior.split(file.find).join(file.replaceWith) : prior;
          if (sha256Hex(post) !== file.expectedPostSha256) {
            skippedPaths.push({
              path: file.path,
              reason: "derived post-content does not hash to the approved post-state; update not actuated",
            });
            continue;
          }
          writes.push({ path: file.path, content: post });
          committedPaths.push(file.path);
          continue;
        }
        // create
        if (await existsOnBase(file.path, baseSha)) {
          skippedPaths.push({
            path: file.path,
            reason: "path already exists on the base branch; create-only op not actuated",
          });
          continue;
        }
        writes.push({ path: file.path, content: file.content });
        committedPaths.push(file.path);
      }
      if (committedPaths.length === 0) {
        throw new Error(
          `none of the ${req.files.length} requested path(s) produced a committable change at base commit ${baseSha}: ` +
            skippedPaths.map((s) => `${s.path} (${s.reason})`).join("; "),
        );
      }

      // 4. Blob per admitted write.
      const blobShas: string[] = [];
      for (const file of writes) {
        const blob = await api<{ sha: string }>("/git/blobs", {
          method: "POST",
          body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
        });
        blobShas.push(blob.sha);
      }

      // 5. New tree on top of the base tree. Every written entry uses the
      //    regular-file mode 100644 — same as creates. Governed text updates
      //    and renames target regular files; an executable (100755) target
      //    would have its mode normalized by this commit, which is visible in
      //    the PR diff and still subject to human review before merge.
      //    A rename's source is removed with `sha: null` — the Git Data API's
      //    deletion form — in the SAME tree that writes the destination, so
      //    both halves land atomically or not at all.
      const tree = await api<{ sha: string }>("/git/trees", {
        method: "POST",
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [
            ...writes.map((file, i) => ({
              path: file.path,
              mode: "100644",
              type: "blob",
              sha: blobShas[i],
            })),
            ...deletions.map((path) => ({
              path,
              mode: "100644",
              type: "blob",
              sha: null,
            })),
          ],
        }),
      });

      // 6. Commit.
      const commit = await api<{ sha: string }>("/git/commits", {
        method: "POST",
        body: JSON.stringify({ message: req.commitMessage, tree: tree.sha, parents: [baseSha] }),
      });

      // 7. Branch ref.
      await api("/git/refs", {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${req.headBranch}`, sha: commit.sha }),
      });

      // 8. Pull request. If this fails AFTER the branch ref was created, roll the
      //    ref back so we never leave an orphan branch that would make a retry
      //    with the same headBranch hit 422 (ref-already-exists).
      let pr: { html_url: string; number: number };
      try {
        pr = await api<{ html_url: string; number: number }>("/pulls", {
          method: "POST",
          body: JSON.stringify({
            title: req.title,
            head: req.headBranch,
            base: baseBranch,
            body: req.body,
          }),
        });
      } catch (prErr) {
        await tryDeleteRef(req.headBranch);
        throw prErr;
      }

      return {
        url: pr.html_url,
        number: pr.number,
        headBranch: req.headBranch,
        baseBranch,
        commitSha: commit.sha,
        committedPaths,
        skippedPaths,
      };
    },
  };
}
