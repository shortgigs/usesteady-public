/**
 * Replay trace target validation (exactly one target, no wildcards or traversal).
 */

import { REPLAY_TRACE_TARGET_PREFIX } from "./constants.js";

export type ReplayTraceTargetValidation =
  | { readonly ok: true; readonly normalized_target: string }
  | { readonly ok: false; readonly cause: string; readonly reason: string };

const WILDCARD_PATTERN = /[*?]|\*\*/;
const TRAVERSAL_PATTERN = /(^|\/)\.\.(\/|$)/;

export function validateReplayTraceTarget(raw: string): ReplayTraceTargetValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok:     false,
      cause:  "target_missing",
      reason: "replay_trace_target is required.",
    };
  }

  if (WILDCARD_PATTERN.test(trimmed)) {
    return {
      ok:     false,
      cause:  "target_wildcard",
      reason: "Wildcard trace targets are not permitted.",
    };
  }

  if (TRAVERSAL_PATTERN.test(trimmed)) {
    return {
      ok:     false,
      cause:  "target_traversal",
      reason: "Parent traversal (..) is not permitted.",
    };
  }

  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return {
      ok:     false,
      cause:  "target_absolute",
      reason: "Absolute paths outside the replay trace namespace are not permitted.",
    };
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized.startsWith(REPLAY_TRACE_TARGET_PREFIX)) {
    return {
      ok:     false,
      cause:  "target_outside_namespace",
      reason: `Trace target must start with ${REPLAY_TRACE_TARGET_PREFIX}`,
    };
  }

  if (normalized.endsWith("/")) {
    return {
      ok:     false,
      cause:  "target_incomplete",
      reason: "Trace target must refer to a single trace artifact, not a directory trailing slash.",
    };
  }

  return { ok: true, normalized_target: normalized };
}
