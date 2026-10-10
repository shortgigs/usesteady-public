/**
 * src/shell/cli/resolve-spec-path.ts
 *
 * Stabilization P0 — PR-5 (surface parity)
 * -----------------------------------------------------------------------------
 * Resolves the spec-path argv for `usesteady run [spec.json] [workspace-root]`
 * under the documented two-positional contract.
 *
 * Rule (D2, locked):
 *
 *   1. If the user supplies an ABSOLUTE spec path:
 *      use it as-is. workspaceRoot is irrelevant to path resolution.
 *
 *   2. If the user supplies a RELATIVE spec path:
 *      a. If a workspaceRoot was EXPLICITLY provided (two positionals —
 *         `run spec.json /some/root`), resolve the spec against
 *         workspaceRoot. This is the PR-5 fix — previously the spec was
 *         resolved vs process.cwd() regardless, contradicting the
 *         documented surface `workflow [spec.json] [workspace-root]`.
 *      b. If NO workspaceRoot was provided (one positional —
 *         `run ./sub/spec.json`), resolve the spec against
 *         process.cwd(). This preserves today's single-arg behavior
 *         byte-for-byte.
 *
 * This module is a *pure function carrier* — no I/O, no error branching.
 * `loadWorkflowSpecFromFile` does the actual read and keeps its own
 * concern (file-path reader; does not know about workspaceRoot).
 *
 * Scope (D5):
 *   - No new flags, no new exit codes, no new error codes.
 *   - No grammar change.
 *   - Single-arg behavior is byte-for-byte unchanged.
 */

import { isAbsolute, resolve as resolvePath } from "node:path";

export interface ResolveSpecPathParams {
  /** Raw spec path from argv. undefined when no spec was provided. */
  readonly rawSpecPath: string | undefined;
  /**
   * Workspace root — either the user's explicit positional or
   * process.cwd() fallback. Must be an absolute or cwd-relative path
   * suitable for `path.resolve`.
   */
  readonly workspaceRoot: string;
  /**
   * True iff the CALLER observed two positionals in argv (`run spec.json
   * <root>`). False when only one positional was present (`run spec.json`
   * or `run <root>` or nothing). This is the signal that the user
   * intends the spec path to be interpreted relative to workspaceRoot.
   */
  readonly hasExplicitWorkspaceRoot: boolean;
  /**
   * Optional override for process.cwd(). Exists so tests can deterministically
   * assert cwd-relative resolution without mutating the real process cwd.
   */
  readonly cwd?: string;
}

/**
 * Pure resolver. Returns `undefined` iff `rawSpecPath` is `undefined`
 * (no spec supplied — interactive builder path). Otherwise always
 * returns an absolute path.
 */
export function resolveWorkflowSpecPath(params: ResolveSpecPathParams): string | undefined {
  const { rawSpecPath, workspaceRoot, hasExplicitWorkspaceRoot } = params;
  if (rawSpecPath === undefined) return undefined;
  if (isAbsolute(rawSpecPath)) return rawSpecPath;
  if (hasExplicitWorkspaceRoot) {
    // Fix A: resolve relative spec against the explicit workspaceRoot
    // so `usesteady run spec.json /some/root` finds spec.json inside
    // /some/root, matching the documented `workflow [spec.json]
    // [workspace-root]` contract.
    return resolvePath(workspaceRoot, rawSpecPath);
  }
  const base = params.cwd ?? process.cwd();
  return resolvePath(base, rawSpecPath);
}
