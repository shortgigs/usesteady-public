/**
 * Replay namespace single-path metadata I/O defaults.
 * @see docs/product/replay-namespace-single-path-metadata-implementation-contract-v1.md
 */

export const REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE =
  "replay_namespace_single_path_metadata" as const;

export type ReplayNamespaceSinglePathMetadataScope =
  typeof REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE;

export const REPLAY_WORKER_PER_SCOPE_IO_VERSION = "v1";

export const REPLAY_WORKER_PER_SCOPE_IO_ELIGIBILITY_TTL_MS = 300_000;

/** Relative paths must live under this replay-namespace prefix. */
export const REPLAY_NAMESPACE_PATH_PREFIX = "replay/ns/";

export const ALLOWED_METADATA_PATCH_KEYS = [
  "replay_namespace_label",
  "replay_namespace_note",
  "replay_namespace_tag",
] as const;

export type AllowedMetadataPatchKey = (typeof ALLOWED_METADATA_PATCH_KEYS)[number];

/** Keys that imply file content mutation — always rejected. */
export const FORBIDDEN_METADATA_PATCH_KEYS = [
  "content",
  "body",
  "data",
  "file_content",
  "buffer",
  "bytes",
  "payload",
  "text",
  "raw",
] as const;

export function isReplayNamespaceSinglePathMetadataScope(
  value: string,
): value is ReplayNamespaceSinglePathMetadataScope {
  return value === REPLAY_NAMESPACE_SINGLE_PATH_METADATA_SCOPE;
}
