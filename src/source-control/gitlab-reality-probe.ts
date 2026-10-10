// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * GitLab SCM reality probe — verifies claimed-ran create_file ops landed on the
 * content-addressed head branch with the approved content. Independent of the
 * actuator: its own GitLab "raw file" read, so it does not share the actuator's
 * blind spots. The raw endpoint returns exact bytes for any size (no base64 /
 * empty-content edge case). Shares only the verdict core with the GitHub probe.
 */

import type { RealityProbe } from "../governed-decision/stages/observation.js";
import { buildScmRealityProbe } from "./scm-reality-core.js";

export type GitLabRealityProbeConfig = {
  readonly token: string;
  /** Full namespace path, e.g. "group/project". */
  readonly projectPath: string;
  /** MUST match the executor's branchPrefix (content-addressed branch derivation). */
  readonly branchPrefix?: string;
  /** API base; override for self-managed GitLab. Default: https://gitlab.com/api/v4 */
  readonly apiBase?: string;
};

const DEFAULT_API_BASE = "https://gitlab.com/api/v4";

export function makeGitLabRealityProbe(config: GitLabRealityProbeConfig): RealityProbe {
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const projectBase = `${apiBase}/projects/${encodeURIComponent(config.projectPath)}`;

  return buildScmRealityProbe(async (safePath: string, headBranch: string): Promise<string | null> => {
    const encPath = encodeURIComponent(safePath); // file path is one segment for GitLab
    const res = await fetch(
      `${projectBase}/repository/files/${encPath}/raw?ref=${encodeURIComponent(headBranch)}`,
      {
        headers: {
          "PRIVATE-TOKEN": config.token,
          "User-Agent": "usesteady/scm-reality-probe",
        },
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`GitLab API ${res.status} /repository/files/${safePath}/raw: ${text}`);
    }
    return res.text();
  }, config.branchPrefix);
}
