/**
 * Runtime capability registry types (metadata only — no execution).
 * @see docs/product/runtime-capability-registry-contract-v1.md
 * @see docs/product/runtime-capability-registry-implementation-contract-v1.md
 */

import type { ExecutionCapabilityId } from "../remediation/types.js";

export type { ExecutionCapabilityId };

export type RuntimeCapabilityBinding = {
  readonly capability_id: ExecutionCapabilityId;
  readonly handler_name: string;
  readonly allowed_inputs_schema: string;
  readonly forbidden_side_effects: readonly string[];
  readonly version: string;
};

/** Resolved binding metadata — not an execution result. */
export type RuntimeCapabilityResolution = {
  readonly capability_id: ExecutionCapabilityId;
  readonly handler_name: string;
  readonly allowed_inputs_schema: string;
  readonly forbidden_side_effects: readonly string[];
  readonly version: string;
  readonly resolved_at: string;
};

export type ResolutionBlocked = {
  readonly outcome: "blocked";
  readonly capability_id: string;
  readonly reason_code: "unknown_capability" | "registry_miss";
};

export type ResolveCapabilityBindingResult =
  | RuntimeCapabilityResolution
  | ResolutionBlocked;
