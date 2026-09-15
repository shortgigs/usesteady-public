/**
 * Pure runtime capability binding resolver (metadata only).
 */

import {
  RUNTIME_CAPABILITY_BINDINGS_V1,
  isKnownExecutionCapabilityId,
} from "./runtime-bindings.js";
import type {
  ExecutionCapabilityId,
  ResolutionBlocked,
  ResolveCapabilityBindingResult,
  RuntimeCapabilityBinding,
  RuntimeCapabilityResolution,
} from "./types.js";

export type ResolveCapabilityBindingOptions = {
  /** ISO-8601 timestamp for deterministic tests; omit for empty string in pure calls. */
  readonly resolved_at?: string;
  readonly bindings?: readonly RuntimeCapabilityBinding[];
};

function bindingByCapabilityId(
  capability_id: ExecutionCapabilityId,
  bindings: readonly RuntimeCapabilityBinding[],
): RuntimeCapabilityBinding | undefined {
  return bindings.find((row) => row.capability_id === capability_id);
}

function toResolution(
  binding: RuntimeCapabilityBinding,
  resolved_at: string,
): RuntimeCapabilityResolution {
  return {
    capability_id:         binding.capability_id,
    handler_name:          binding.handler_name,
    allowed_inputs_schema: binding.allowed_inputs_schema,
    forbidden_side_effects: binding.forbidden_side_effects,
    version:               binding.version,
    resolved_at,
  };
}

function blocked(
  capability_id: string,
  reason_code: ResolutionBlocked["reason_code"],
): ResolutionBlocked {
  return {
    outcome:       "blocked",
    capability_id,
    reason_code,
  };
}

/**
 * Exact lookup by capability_id only — no inference, I/O, or handler execution.
 */
export function resolveCapabilityBinding(
  capability_id: string,
  options: ResolveCapabilityBindingOptions = {},
): ResolveCapabilityBindingResult {
  const bindings = options.bindings ?? RUNTIME_CAPABILITY_BINDINGS_V1;
  const resolved_at = options.resolved_at ?? "";

  if (!isKnownExecutionCapabilityId(capability_id)) {
    return blocked(capability_id, "unknown_capability");
  }

  const row = bindingByCapabilityId(capability_id, bindings);
  if (!row) {
    return blocked(capability_id, "registry_miss");
  }

  return toResolution(row, resolved_at);
}

/** Stable fields for determinism tests (excludes resolved_at). */
export function resolutionFingerprint(
  resolution: RuntimeCapabilityResolution,
): string {
  return JSON.stringify({
    capability_id:         resolution.capability_id,
    handler_name:          resolution.handler_name,
    allowed_inputs_schema: resolution.allowed_inputs_schema,
    forbidden_side_effects: resolution.forbidden_side_effects,
    version:               resolution.version,
  });
}
