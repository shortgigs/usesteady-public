// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * Public surface for the multi-provider Source Control subsystem (Fork A: kernel
 * SCM actuation). Import provider seam, adapters, and the kernel bridge from here.
 */

export type {
  SourceControlProvider,
  SourceControlProviderId,
  ProviderCapabilities,
  ScmFileChange,
  OpenPullRequestRequest,
  OpenPullRequestResult,
} from "./provider.js";

export { makeGitHubProvider } from "./providers/github.js";
export type { GitHubProviderConfig } from "./providers/github.js";

export { makeGitLabProvider } from "./providers/gitlab.js";
export type { GitLabProviderConfig } from "./providers/gitlab.js";

export { makeScmExecutor, safeRepoPath, deriveScmBranch, DEFAULT_BRANCH_PREFIX } from "./scm-executor.js";
export type { ScmActuationConfig } from "./scm-executor.js";

export { makeScmRealityProbe } from "./scm-reality-probe.js";
export type { ScmRealityProbeConfig } from "./scm-reality-probe.js";

export { makeGitLabRealityProbe } from "./gitlab-reality-probe.js";
export type { GitLabRealityProbeConfig } from "./gitlab-reality-probe.js";

export type { ScmFileReader } from "./scm-reality-core.js";
export { buildScmRealityProbe } from "./scm-reality-core.js";
