/**
 * Metadata patch validation — bounded keys only, no content mutation fields.
 */

import {
  ALLOWED_METADATA_PATCH_KEYS,
  FORBIDDEN_METADATA_PATCH_KEYS,
} from "./constants.js";
import type { ReplayNamespaceMetadataPatch } from "./types.js";

export type MetadataPatchValidation =
  | { readonly ok: true; readonly patch: ReplayNamespaceMetadataPatch }
  | { readonly ok: false; readonly cause: string; readonly reason: string };

export function validateMetadataPatch(raw: unknown): MetadataPatchValidation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok:     false,
      cause:  "metadata_patch_invalid",
      reason: "metadata_patch must be a plain object.",
    };
  }

  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length === 0) {
    return {
      ok:     false,
      cause:  "metadata_patch_empty",
      reason: "metadata_patch must include at least one allowed metadata field.",
    };
  }

  for (const key of keys) {
    if ((FORBIDDEN_METADATA_PATCH_KEYS as readonly string[]).includes(key)) {
      return {
        ok:     false,
        cause:  "content_mutation_forbidden",
        reason: `metadata_patch key "${key}" implies file content mutation and is forbidden.`,
      };
    }
    if (!(ALLOWED_METADATA_PATCH_KEYS as readonly string[]).includes(key)) {
      return {
        ok:     false,
        cause:  "metadata_key_unknown",
        reason: `metadata_patch key "${key}" is not an allowed v1 metadata field.`,
      };
    }
    const value = record[key];
    if (typeof value !== "string") {
      return {
        ok:     false,
        cause:  "metadata_value_invalid",
        reason: `metadata_patch.${key} must be a string.`,
      };
    }
  }

  const patch: ReplayNamespaceMetadataPatch = {};
  for (const key of ALLOWED_METADATA_PATCH_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      patch[key] = value;
    }
  }

  return { ok: true, patch };
}
