/**
 * Kernel v1 / K5 + K6 -- run_command structural determinism classifier.
 *
 * -- Scope (K5 design doc v1.0 section 5.1; K6 design doc v1.0 section 3) -----
 *
 *   Pure structural predicate over a `WorkflowTaskSpec.command` string. Returns
 *   true iff the command string belongs to the closed K5 + K6 allow-list of
 *   provably deterministic command shapes. Returns false for ALL other inputs.
 *
 *   The K5 allow-list (LOCKED, alpha.59):
 *     - `echo <args>`             - cross-shell safe; runs via spawnSync(shell:true)
 *     - `true`                    - direct short-circuit to {accepted}, no shell
 *     - `false`                   - direct short-circuit to {failed},   no shell
 *
 *   The K6 widening (LOCKED, K6 design doc v1.0):
 *     - `node -e "<BODY>"`        - inline JS replay where BODY satisfies the
 *                                   K6 closed predicate `isReplayableInlineJsShape`.
 *                                   Executed via spawnSync('node', ['-e', body],
 *                                   { shell: false, cwd: sandbox.path, ... }).
 *
 *   Dropped in v1.0 lock (see K5 design D1 / section 11; K6 design section 14):
 *     - `mkdir -p <path>` (redundant with operationType: "create_dir")
 *     - `rm -rf <path>`   (redundant with operationType: "delete_file")
 *     - `node -p`, `node -r`, `node script.js`, `node --eval` (K7+ scope)
 *     - multi-segment shell (`&&`, `;`, `|`) -- K7 candidate
 *     - timeout policy                       -- K7 candidate
 *
 * -- Layered decision (K5-I13 + K6-I4 default-deny) ---------------------------
 *
 *   The router applies probes in order; the first matching probe wins.
 *
 *   Probe 1 (K6 prefix): whole command matches `^node -e "<BODY>"$` exactly,
 *     where BODY contains no `"` or `\\` (inline-js-classifier.ts /
 *     `isK6NodeECommandShape`). If matched, the body is extracted and passed
 *     through `isReplayableInlineJsShape`. This probe runs BEFORE the K5
 *     SHELL_METACHARACTERS denylist because the K5 denylist forbids `"`
 *     (which the K6 command form requires) -- see K6 design doc section 6.3.
 *
 *   Probe 2 (K5 gate 1 denylist, on sight): trimmed command must NOT contain
 *     any of $ ` | > < & ; ( ) * ? [ ] ~ \\ { } " '
 *
 *   Probe 3 (K5 gate 2 allowlist regex): trimmed command must match exactly
 *     one of ^echo(\s+\S+)+$  /  ^true$  /  ^false$
 *
 *   Failure at every probe -> command is non-replayable. The caller (K4
 *   classifier `isReplayableTaskSpec`) distinguishes between
 *   `reason: "non_deterministic_command"` (K5-shape refusal) and
 *   `reason: "non_deterministic_inline_js"` (K6-shape refusal) by checking
 *   the K6 prefix again at the classifier layer.
 *
 * -- Why three probes instead of one regex ------------------------------------
 *
 *   The K5 denylist is a sharp, content-addressed sanity check that catches
 *   shell-metacharacter injection on commands that would otherwise pass the
 *   coarse allowlist regex. Example: `echo $HOME` would parse as
 *   `^echo\s+\S+$` if `$` were unicode-allowed by `\S`; the denylist catches
 *   the `$` upstream. This is the same shape as K4's two-gate path containment
 *   (isContainedRelativePath: drive-letter check, then normalize-and-..-check).
 *
 *   The K6 prefix probe runs first because the K6 command form `node -e "..."`
 *   contains a `"` character which would be caught by the K5 denylist. By
 *   routing through the K6 probe first, the K5 denylist stays BYTE-FOR-BYTE
 *   UNCHANGED for every K5-era command and the K6 widening is isolated
 *   behind a structural prefix check (K6 design doc section 3 Option A).
 *
 *   Pure function. No I/O. No imports outside the kernel layer.
 */

import {
  isK6NodeECommandShape,
  extractK6Body,
  isReplayableInlineJsShape,
} from "./inline-js-classifier.js";

const SHELL_METACHARACTERS = /[$`|><&;()*?[\]~\\{}"']/;

const ECHO_PATTERN  = /^echo(\s+\S+)+$/;
const TRUE_PATTERN  = /^true$/;
const FALSE_PATTERN = /^false$/;

/**
 * True iff `command` is in the K5 + K6 replayable shape allow-list.
 *
 * Non-strings, empty strings, and untrimmed-whitespace-only strings all
 * return false (the K5-I13 / K6-I4 default-deny posture).
 *
 * Routing (K6-I12):
 *   1. If the command matches the K6 prefix (`node -e "<BODY>"`) AND the
 *      extracted BODY passes `isReplayableInlineJsShape`, return true.
 *   2. Otherwise, fall through to the K5 two-gate path.
 */
export function isReplayableCommandShape(command: unknown): boolean {
  if (typeof command !== "string") return false;
  const trimmed = command.trim();
  if (trimmed.length === 0)        return false;

  // K6 prefix probe -- runs BEFORE the K5 denylist (the K5 denylist
  // forbids `"`, which the K6 form requires). Per K6 design section 3 / 6.3,
  // this routing keeps the K5 denylist byte-for-byte unchanged.
  if (isK6NodeECommandShape(trimmed)) {
    const body = extractK6Body(trimmed);
    return body !== null && isReplayableInlineJsShape(body);
  }

  // K5 path: byte-for-byte unchanged from alpha.59.
  // Gate 1: shell metacharacter denylist.
  if (SHELL_METACHARACTERS.test(trimmed)) return false;

  // Gate 2: closed-set allowlist regex.
  return ECHO_PATTERN.test(trimmed)
      || TRUE_PATTERN.test(trimmed)
      || FALSE_PATTERN.test(trimmed);
}

// === In-scope bucket (executor seam) =======================================
//
// The executor needs to know which strategy to dispatch. K5 returned a
// bare string union; K6 widens to an object discriminant because the
// `node_e` bucket carries the extracted body the executor needs to spawn
// with. TypeScript exhaustiveness on this union is the K6-design-doc-
// section-13 K6-I14 contract: every consumer must handle the new variant
// explicitly.

export type InScopeCommand =
  | { readonly kind: "echo";   readonly command: string }
  | { readonly kind: "true" }
  | { readonly kind: "false" }
  | { readonly kind: "node_e"; readonly body: string };

/**
 * Internal-export-for-K5+K6-executor: classify a known-in-scope command into
 * its execution-strategy bucket. Only callers that have ALREADY confirmed
 * `isReplayableCommandShape(command) === true` should call this.
 *
 * Returns:
 *   - { kind: "echo",   command } : run via spawnSync(..., { shell: true })
 *   - { kind: "true"  }           : short-circuit to {accepted}, no shell
 *   - { kind: "false" }           : short-circuit to {failed},   no shell
 *   - { kind: "node_e", body }    : run via spawnSync('node', ['-e', body],
 *                                   { shell: false }) -- K6 path
 *
 * Throws if called with a command that does not match any in-scope shape;
 * this is a programmer error (precondition violation), not a user error.
 *
 * @internal -- only the K5+K6 executor in execution-replay.ts is expected
 * to call this.
 */
export function classifyInScopeCommand(command: string): InScopeCommand {
  const trimmed = command.trim();

  // K6 path: prefix probe + body extraction. Runs first so the K6 body's
  // double quotes do not collide with the K5 short-form regex set.
  if (isK6NodeECommandShape(trimmed)) {
    const body = extractK6Body(trimmed);
    if (body !== null && isReplayableInlineJsShape(body)) {
      return { kind: "node_e", body };
    }
  }

  if (TRUE_PATTERN.test(trimmed))  return { kind: "true" };
  if (FALSE_PATTERN.test(trimmed)) return { kind: "false" };
  if (ECHO_PATTERN.test(trimmed))  return { kind: "echo", command: trimmed };

  throw new Error(
    `classifyInScopeCommand called with non-in-scope command: ${JSON.stringify(command)}. ` +
    `Caller must verify isReplayableCommandShape() first.`,
  );
}
