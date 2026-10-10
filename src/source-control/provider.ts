// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * SourceControlProvider seam — the provider-agnostic actuation port.
 *
 * Part of the multi-provider Source Control plan (Fork A: kernel SCM actuation).
 * A ratified governed decision can be actuated as a pull/merge request on the
 * operator's chosen provider. This seam mirrors how the kernel already isolates
 * `DeterministicExecutor` / `RealityProbe`: callers depend on the interface and
 * the declared CAPABILITIES, never on the concrete provider's identity.
 *
 * ── Authority boundary ─────────────────────────────────────────────────────────
 *
 *   ZERO authority. A provider is transport/actuation only. It never decides
 *   whether a change is allowed — the human ratification gate upstream already
 *   did that. It only turns approved file operations into a PR/MR.
 *
 * ── Capability-typed, not lowest-common-denominator ───────────────────────────
 *
 *   Each provider declares what it supports. Callers branch on the declared
 *   capability (e.g. `trackEmptyDirectories`), never on `id`. Git-based providers
 *   cannot represent an empty directory in a commit, so `trackEmptyDirectories`
 *   is false for all of them; the SCM executor reports a `create_dir` op honestly
 *   as not-actuated rather than fabricating a placeholder file.
 */

/**
 * A single file change in the actuated commit. Repo-relative path.
 *
 * `create` is the original create-only shape (no-clobber: refused if the path
 * already exists at the pinned base commit).
 *
 * `update` (L4.S2) mirrors the FS executor's `replace_in_file` under the same
 * destructive-op scrutiny, inverted for existence (must-exist instead of
 * no-clobber, still pinned to the immutable base commit sha): the provider
 * reads the file content AT the base commit, refuses unless it hashes to
 * `expectedPriorSha256` (the pre-state the human's approval is anchored to),
 * derives the post content deterministically (every `find` occurrence
 * replaced), verifies it hashes to `expectedPostSha256`, and only then commits.
 * The full post content is never shipped in the request — it is derived from
 * the pinned prior content, so a base that drifted since approval is refused,
 * never silently re-anchored.
 *
 * `rename` (R2) mirrors the FS executor's `rename_file`: in git a rename is a
 * delete of the source path plus a write of the SAME pinned content at the
 * destination, in ONE tree commit — never two commits (a delete-then-create
 * pair could land half). Admission is pinned to the immutable base commit sha:
 * the source must exist there and hash to `expectedPriorSha256` (the content
 * the human's approval is anchored to — moving content the human never saw
 * would detach the approval from reality), and the destination must be free
 * there (no-clobber: a rename never overwrites content nobody approved). The
 * committed destination content is the PINNED prior content read at the base —
 * never re-supplied by the caller. In `committedPaths`/`skippedPaths` a rename
 * is identified by its SOURCE path (the op union's common `path` field).
 */
export type ScmFileChange =
  | {
      readonly kind: "create";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly kind: "update";
      readonly path: string;
      /** The exact text to replace (every occurrence), verbatim from the approved op. */
      readonly find: string;
      /** The replacement text, verbatim from the approved op. */
      readonly replaceWith: string;
      /** sha256 (hex) of the file content the approval is anchored to. */
      readonly expectedPriorSha256: string;
      /** sha256 (hex) of the deterministically-derived post-content. */
      readonly expectedPostSha256: string;
    }
  | {
      readonly kind: "rename";
      /** The SOURCE repo path (identifies the rename in committed/skipped paths). */
      readonly path: string;
      /** The destination repo path. */
      readonly toPath: string;
      /** sha256 (hex) of the source content the approval is anchored to. */
      readonly expectedPriorSha256: string;
    };

export type OpenPullRequestRequest = {
  /** Target branch to merge into. When omitted, the provider uses the repo default branch. */
  readonly baseBranch?: string;
  /** The new branch to create for this change. Must not already exist. */
  readonly headBranch: string;
  readonly title: string;
  readonly body: string;
  readonly commitMessage: string;
  /** Files written into the single commit on `headBranch`. */
  readonly files: readonly ScmFileChange[];
};

export type OpenPullRequestResult = {
  /** Web URL of the created PR/MR. */
  readonly url: string;
  readonly number: number;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly commitSha: string;
  /** Paths actually written into the commit, in request order. */
  readonly committedPaths: readonly string[];
  /**
   * Requested paths the provider refused to commit, each with an honest,
   * token-free reason (e.g. create no-clobber conflict; update target absent,
   * changed since approval, or already at the post-state). Lets the caller
   * report per-op failure details instead of a generic guess. Optional for
   * backward compatibility; absent means only the create-conflict legacy
   * behavior applies.
   */
  readonly skippedPaths?: readonly { readonly path: string; readonly reason: string }[];
};

export type ProviderCapabilities = {
  readonly openPullRequest: boolean;
  /** Git-based providers cannot commit an empty directory: always false for them. */
  readonly trackEmptyDirectories: boolean;
  /**
   * Whether the provider implements hash-pinned `update` file changes (L4.S2).
   * Callers branch on this capability (never on provider id) and pre-fail
   * update ops honestly when it is false.
   */
  readonly updateFiles: boolean;
  /**
   * Whether the provider implements hash-pinned `rename` file changes (R2:
   * delete source + write pinned content at destination, one tree commit).
   * Callers branch on this capability (never on provider id) and pre-fail
   * rename ops honestly when it is false.
   */
  readonly renameFiles: boolean;
};

export type SourceControlProviderId =
  | "github"
  | "gitlab"
  | "azure-devops"
  | "bitbucket-cloud";

export interface SourceControlProvider {
  readonly id: SourceControlProviderId;
  readonly capabilities: ProviderCapabilities;
  /**
   * Create a branch, commit the files, and open a PR/MR. Async (network).
   * Throws on any provider error; the caller (the SCM executor bridge) catches
   * and degrades to a faithful, honest `ExecutorOutcome`.
   */
  openPullRequest(req: OpenPullRequestRequest): Promise<OpenPullRequestResult>;
}
