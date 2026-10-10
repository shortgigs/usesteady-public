/**
 * Replay-namespace path validation (exactly one path, no wildcards or traversal).
 */

import { REPLAY_NAMESPACE_PATH_PREFIX } from "./constants.js";

export type ReplayNamespacePathValidation =
  | { readonly ok: true; readonly normalized_path: string }
  | { readonly ok: false; readonly cause: string; readonly reason: string };

const WILDCARD_PATTERN = /[*?]|\*\*/;
const TRAVERSAL_PATTERN = /(^|\/)\.\.(\/|$)/;

export function validateReplayNamespacePath(raw: string): ReplayNamespacePathValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok:     false,
      cause:  "path_missing",
      reason: "replay_namespace_path is required.",
    };
  }

  if (WILDCARD_PATTERN.test(trimmed)) {
    return {
      ok:     false,
      cause:  "path_wildcard",
      reason: "Wildcard paths are not permitted.",
    };
  }

  if (TRAVERSAL_PATTERN.test(trimmed)) {
    return {
      ok:     false,
      cause:  "path_traversal",
      reason: "Parent traversal (..) is not permitted.",
    };
  }

  if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return {
      ok:     false,
      cause:  "path_absolute",
      reason: "Absolute paths outside the replay namespace are not permitted.",
    };
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized.startsWith(REPLAY_NAMESPACE_PATH_PREFIX)) {
    return {
      ok:     false,
      cause:  "path_outside_namespace",
      reason: `Path must start with ${REPLAY_NAMESPACE_PATH_PREFIX}`,
    };
  }

  if (normalized.endsWith("/")) {
    return {
      ok:     false,
      cause:  "path_incomplete",
      reason: "Path must refer to a single file entry, not a directory trailing slash.",
    };
  }

  return { ok: true, normalized_path: normalized };
}
