/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - on-machine redaction.
 *
 * INV-ERB-P3: resource paths MAY be redacted/allowlisted on the machine, before
 * transport. This module is that hook. It is PURE (no I/O) and DEFAULT-IDENTITY:
 * with no policy, nothing is dropped (the caller opted in to the bridge but not
 * to any path filtering).
 *
 * Privacy posture: a dropped resource is removed silently from the wire. We do
 * NOT emit a "N resources were hidden" count on the wire (there is no field for
 * it in v1), so redaction never leaks the existence of filtered paths. The
 * dropped count is returned to the caller for local logging only.
 */

import type { ExecutionReturnAffectedResource } from "./types.js";

export type RedactionPolicy = {
  /**
   * When non-empty, ONLY resources whose path starts with one of these prefixes
   * are kept. Empty/undefined = keep all (subject to denySubstrings).
   */
  readonly allowPrefixes?: readonly string[];
  /**
   * Resources whose path contains any of these substrings are dropped. Applied
   * AFTER allowPrefixes. Use for obvious secret-bearing paths (e.g. ".env",
   * "secrets/", "credentials").
   */
  readonly denySubstrings?: readonly string[];
};

export type RedactionResult = {
  readonly kept: readonly ExecutionReturnAffectedResource[];
  /** Number of resources removed by the policy (local signal only - never sent). */
  readonly droppedCount: number;
};

function isEmpty(arr: readonly unknown[] | undefined): boolean {
  return !arr || arr.length === 0;
}

/**
 * Apply a redaction policy to affected resources. Pure; order-preserving.
 * With no policy (or an empty one), this is the identity function.
 */
export function redactAffectedResources(
  resources: readonly ExecutionReturnAffectedResource[],
  policy?: RedactionPolicy,
): RedactionResult {
  if (!policy || (isEmpty(policy.allowPrefixes) && isEmpty(policy.denySubstrings))) {
    return { kept: resources, droppedCount: 0 };
  }

  const allow = policy.allowPrefixes ?? [];
  const deny = policy.denySubstrings ?? [];

  const kept = resources.filter((r) => {
    if (allow.length > 0 && !allow.some((p) => r.path.startsWith(p))) return false;
    if (deny.length > 0 && deny.some((s) => r.path.includes(s))) return false;
    return true;
  });

  return { kept, droppedCount: resources.length - kept.length };
}
