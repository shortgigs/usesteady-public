// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * GitHub SCM reality probe — the kernel's INDEPENDENT post-actuation verifier for
 * source-control execution. Mirrors the filesystem reality probe's contract: it
 * never trusts the executor's own success claim; it re-derives what was claimed
 * `ran` and falsifies it against the real world (here, GitHub).
 *
 * ── Independence (why this does NOT reuse the provider) ─────────────────────────
 *
 *   The actuator (makeGitHubProvider) and this probe are deliberately separate
 *   code paths with their own HTTP calls. If the probe reused the provider it
 *   would share its blind spots (a bug that "committed" to the wrong place would
 *   also be "verified" in the wrong place). So the probe runs its own minimal
 *   GitHub Contents read against the head branch the PR was opened from, decodes
 *   the committed blob, and compares it byte-for-byte to the approved op content.
 *
 * ── Verdict (gauge law) ─────────────────────────────────────────────────────────
 *
 *   - no create_file op was claimed ran            -> unknown (nothing to verify)
 *   - every claimed file is present on the head
 *     branch with matching content                 -> agree
 *   - any claimed file is absent / differs / errors -> disagree
 *
 *   The probe is read-only and never throws into the spine; an unexpected error
 *   degrades the relevant op to a disagreement detail rather than crashing.
 */

import type { RealityProbe } from "../governed-decision/stages/observation.js";
import { buildScmRealityProbe } from "./scm-reality-core.js";

export type ScmRealityProbeConfig = {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  /**
   * Prefix for the content-addressed head branch — MUST match the executor's
   * `branchPrefix`. The probe re-derives the branch the PR was opened from via
   * `deriveScmBranch(execution.results[].op)`, so no shared decision id is needed.
   */
  readonly branchPrefix?: string;
  /** API base; override for GitHub Enterprise Server. Default: https://api.github.com */
  readonly apiBase?: string;
};

const DEFAULT_API_BASE = "https://api.github.com";

function encodeRefPath(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/**
 * GitHub SCM reality probe — verifies claimed-ran create_file ops landed on the
 * head branch with the approved content. Independent of the actuator: its own
 * GitHub Contents read (raw media type, so 1-100MB files are not falsely
 * mismatched by the JSON encoding:none empty-content response).
 */
export function makeScmRealityProbe(config: ScmRealityProbeConfig): RealityProbe {
  const apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const repoBase = `${apiBase}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;

  return buildScmRealityProbe(async (safePath: string, headBranch: string): Promise<string | null> => {
    const encPath = safePath.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${repoBase}/contents/${encPath}?ref=${encodeRefPath(headBranch)}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "usesteady/scm-reality-probe",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`GitHub API ${res.status} /contents/${safePath}: ${text}`);
    }
    return res.text();
  }, config.branchPrefix);
}
