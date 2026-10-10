/**
 * Pure remediation proposal generator (candidates only).
 */

import { createHash } from "node:crypto";

import { sortObservations } from "../diagnostics/evaluate.js";
import type { DiagnosticRecord, DiagnosticObservation } from "../diagnostics/types.js";
import { EXECUTION_CAPABILITY_CATALOG_V1 } from "./catalog-v1.js";
import {
  CAPABILITY_REGISTRY_VERSION,
  capabilityIdForObservationCode,
} from "./proposal-bindings.js";
import { PROPOSAL_VERSION, proposalCopyForCode } from "./proposal-copy.js";
import type {
  ExecutionCapability,
  ExecutionCapabilityId,
  RemediationProposal,
  RemediationProposalRecord,
} from "./types.js";

export { PROPOSAL_VERSION } from "./proposal-copy.js";
export { PROPOSAL_CAPABILITY_BINDINGS_V1 } from "./proposal-bindings.js";
export { EXECUTION_CAPABILITY_CATALOG_V1 } from "./catalog-v1.js";

const CREATED_FROM = "diagnostic_record" as const;

const CATALOG_IDS = new Set(
  EXECUTION_CAPABILITY_CATALOG_V1.map((c) => c.capability_id),
);

function catalogEntry(id: ExecutionCapabilityId): ExecutionCapability | undefined {
  return EXECUTION_CAPABILITY_CATALOG_V1.find((c) => c.capability_id === id);
}

/** Stable proposal identity — no timestamp (INV-GEN-5). */
export function stableProposalId(input: {
  readonly diagnostic_id: string;
  readonly diagnostic_code: string;
  readonly capability_id: ExecutionCapabilityId;
  readonly proposal_version: string;
}): string {
  const payload = [
    input.diagnostic_id,
    input.diagnostic_code,
    input.capability_id,
    input.proposal_version,
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

function recordId(diagnostic_id: string): string {
  return createHash("sha256")
    .update([diagnostic_id, PROPOSAL_VERSION, CAPABILITY_REGISTRY_VERSION].join("\0"))
    .digest("hex");
}

function severityAndPriority(obs: DiagnosticObservation): {
  severity: RemediationProposal["severity"];
  priority: RemediationProposal["priority"];
} {
  if (obs.severity === "error") {
    return { severity: "high", priority: 1 };
  }
  return { severity: "medium", priority: 2 };
}

function compareProposals(a: RemediationProposal, b: RemediationProposal): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.diagnostic_code !== b.diagnostic_code) {
    return a.diagnostic_code.localeCompare(b.diagnostic_code);
  }
  return a.proposal_id.localeCompare(b.proposal_id);
}

function buildProposal(
  diagnostic: DiagnosticRecord,
  obs: DiagnosticObservation,
  capability_id: ExecutionCapabilityId,
): RemediationProposal | null {
  const copy = proposalCopyForCode(obs.code);
  const cap = catalogEntry(capability_id);
  if (!copy || !cap) return null;

  const diagnostic_code = obs.code;
  return {
    proposal_id:        stableProposalId({
      diagnostic_id:   diagnostic.diagnostic_id,
      diagnostic_code,
      capability_id,
      proposal_version: PROPOSAL_VERSION,
    }),
    diagnostic_id:      diagnostic.diagnostic_id,
    diagnostic_code,
    capability_id,
    reason:             copy.reason,
    expected_effect:    copy.expected_effect,
    rollback_guidance:  copy.rollback_guidance,
    proposal_version:   PROPOSAL_VERSION,
    created_from:       CREATED_FROM,
    action_class:       copy.action_class,
    title:              copy.title,
    ...severityAndPriority(obs),
  };
}

function computeOverall(
  proposals: readonly RemediationProposal[],
): RemediationProposalRecord["overall"] {
  if (proposals.length === 0) return "none";
  return "proposed";
}

/**
 * Pure generator — diagnostics only, no I/O (INV-GEN-IMPL-1).
 */
export function generateRemediationProposalsFromDiagnostic(
  diagnostic: DiagnosticRecord,
  catalog: readonly ExecutionCapability[] = EXECUTION_CAPABILITY_CATALOG_V1,
): RemediationProposalRecord {
  const catalogIds = new Set(catalog.map((c) => c.capability_id));
  const seenCodes = new Set<string>();
  const proposals: RemediationProposal[] = [];

  for (const obs of sortObservations([...diagnostic.observations])) {
    if (obs.code === "effective_state_fail_closed") continue;
    if (seenCodes.has(obs.code)) continue;

    const capability_id = capabilityIdForObservationCode(obs.code);
    if (!capability_id || !catalogIds.has(capability_id) || !CATALOG_IDS.has(capability_id)) {
      continue;
    }

    const proposal = buildProposal(diagnostic, obs, capability_id);
    if (!proposal) continue;

    seenCodes.add(obs.code);
    proposals.push(proposal);
  }

  proposals.sort(compareProposals);

  const generated_at = diagnostic.run_at;

  return {
    record_id:     recordId(diagnostic.diagnostic_id),
    generated_at,
    diagnostic_id: diagnostic.diagnostic_id,
    overall:       computeOverall(proposals),
    proposals,
  };
}
