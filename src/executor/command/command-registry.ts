/**
 * Frozen command class bindings — lookup only, no execution (INV-RCMD-4).
 */

import type { ExecutionCapabilityId } from "../../remediation/types.js";

export type CommandRegistryEntry = {
  readonly command_class: string;
  readonly capability_id: ExecutionCapabilityId;
  readonly summary: string;
};

/** Descriptive command classes only — no filesystem mutation in v1. */
export const COMMAND_REGISTRY_V1: readonly CommandRegistryEntry[] = [
  {
    command_class: "cache_refresh_descriptive",
    capability_id: "CAP-001",
    summary:       "Would refresh entitlement cache (record only — no mutation)",
  },
  {
    command_class: "transport_recheck_descriptive",
    capability_id: "CAP-002",
    summary:       "Would recheck portal domain transport (record only — no mutation)",
  },
  {
    command_class: "env_validate_descriptive",
    capability_id: "CAP-003",
    summary:       "Would validate environment configuration (record only — no mutation)",
  },
] as const;

export function lookupCommandsForCapability(
  capability_id: string,
): readonly CommandRegistryEntry[] {
  return COMMAND_REGISTRY_V1.filter((e) => e.capability_id === capability_id);
}

export function lookupCommandByClass(
  command_class: string,
): CommandRegistryEntry | undefined {
  const id = command_class.trim();
  return COMMAND_REGISTRY_V1.find((e) => e.command_class === id);
}
