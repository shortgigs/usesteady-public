/**
 * Constitution — Repository provenance capture (Materialization increment 1).
 *
 * Captures the exact repository state a decision depended on (Decision Basis
 * Class 2, Article I). This is the first non-spec Decision Basis fact: the
 * moment it enters the basis, the basis fingerprint diverges from the spec hash
 * (resolving conformance F-C2 — the basis guard becomes independently
 * load-bearing rather than redundant-with-spec-hash).
 *
 * ── Why this is its own file ──────────────────────────────────────────────────
 *
 *   decision-basis.ts is pure (no I/O). Capturing repository provenance reads
 *   git — a side effect. Keeping it here preserves that boundary: capture is the
 *   only thing that touches the environment; assembly and fingerprinting stay
 *   pure and deterministic. The captured fact is *injected* into the basis.
 *
 * ── Determinism + fail-soft ───────────────────────────────────────────────────
 *
 *   - Same repository state -> same fact. No timestamps, no randomness.
 *   - Non-git workspace, missing git binary, or any failure -> a stable
 *     all-null "unavailable" fact. Capture never throws; the constitutional
 *     decision (fail closed on mismatch) belongs to the coordinator, not here.
 *   - Capture grants no authority. It records a fact; it approves nothing.
 */

import { execFileSync } from "node:child_process";

import type { RepositoryProvenanceFact } from "./decision-basis.js";

/** Stable fact used when no repository state can be determined. */
export const REPOSITORY_PROVENANCE_UNAVAILABLE: RepositoryProvenanceFact = {
  identity: null,
  commit:   null,
  dirty:    null,
};

function git(args: readonly string[], cwd: string): string | null {
  try {
    return execFileSync("git", args as string[], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Capture the repository provenance for a workspace.
 *
 * @param workspaceRoot  The directory the decision operates within.
 * @returns A deterministic RepositoryProvenanceFact, or the all-null
 *          "unavailable" fact when the workspace is not a git repository
 *          (or git is unavailable).
 */
export function captureRepositoryProvenance(
  workspaceRoot?: string,
): RepositoryProvenanceFact {
  if (!workspaceRoot) return REPOSITORY_PROVENANCE_UNAVAILABLE;

  const commit = git(["rev-parse", "HEAD"], workspaceRoot);
  if (commit === null) return REPOSITORY_PROVENANCE_UNAVAILABLE;

  const origin = git(["config", "--get", "remote.origin.url"], workspaceRoot);
  const top    = git(["rev-parse", "--show-toplevel"], workspaceRoot);
  const status = git(["status", "--porcelain"], workspaceRoot);

  return {
    identity: origin ?? top ?? workspaceRoot,
    commit,
    dirty: status === null ? null : status.length > 0,
  };
}
