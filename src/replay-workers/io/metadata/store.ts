/**
 * Replay-namespace path metadata sidecar store (metadata fields only).
 * No file content, append, delete, rename, or move.
 */

import type {
  ReplayNamespaceMetadataPatch,
  ReplayNamespacePathMetadataRecord,
} from "./types.js";

const metadataByPath = new Map<string, ReplayNamespacePathMetadataRecord>();

/**
 * Upsert metadata fields for exactly one path — does not touch file content.
 */
export function setReplayNamespacePathMetadata(
  replay_namespace_path: string,
  patch: ReplayNamespaceMetadataPatch,
  updated_at: string,
): ReplayNamespacePathMetadataRecord {
  const existing = metadataByPath.get(replay_namespace_path);
  const replay_namespace_label = patch.replay_namespace_label ?? existing?.replay_namespace_label;
  const replay_namespace_note = patch.replay_namespace_note ?? existing?.replay_namespace_note;
  const replay_namespace_tag = patch.replay_namespace_tag ?? existing?.replay_namespace_tag;
  const next: ReplayNamespacePathMetadataRecord = {
    replay_namespace_path,
    ...(replay_namespace_label !== undefined ? { replay_namespace_label } : {}),
    ...(replay_namespace_note !== undefined ? { replay_namespace_note } : {}),
    ...(replay_namespace_tag !== undefined ? { replay_namespace_tag } : {}),
    updated_at,
  };
  metadataByPath.set(replay_namespace_path, next);
  return next;
}

export function getReplayNamespacePathMetadata(
  replay_namespace_path: string,
): ReplayNamespacePathMetadataRecord | undefined {
  return metadataByPath.get(replay_namespace_path.trim());
}

export function resetReplayNamespaceMetadataStoreForTests(): void {
  metadataByPath.clear();
}
