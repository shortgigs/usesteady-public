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
/**
 * Pure resolver. Returns `undefined` iff `rawSpecPath` is `undefined`
 * (no spec supplied — interactive builder path). Otherwise always
 * returns an absolute path.
 */
export function resolveWorkflowSpecPath(params) {
    const { rawSpecPath, workspaceRoot, hasExplicitWorkspaceRoot } = params;
    if (rawSpecPath === undefined)
        return undefined;
    if (isAbsolute(rawSpecPath))
        return rawSpecPath;
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
//# sourceMappingURL=resolve-spec-path.js.map