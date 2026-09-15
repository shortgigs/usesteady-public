/**
 * Doctor render — remediation proposals (candidates only).
 */

import type { RemediationProposalRecord } from "./types.js";

export const REMEDIATION_PROPOSALS_DISCLAIMER =
  "These are candidates only. Nothing has been executed." as const;

export function renderRemediationProposalsSection(
  record: RemediationProposalRecord,
): string {
  const lines: string[] = [
    "",
    "  --- Remediation proposals (candidates only) ---",
    "",
  ];

  if (record.overall === "none" || record.proposals.length === 0) {
    lines.push("  No remediation proposals for this diagnostic run.");
    lines.push("");
  } else {
    lines.push(`  Status: ${record.overall} (${String(record.proposals.length)})`);
    lines.push("");

    for (const p of record.proposals) {
      lines.push(`  [${p.severity}] ${p.diagnostic_code} → ${p.capability_id}`);
      lines.push(`    Title: ${p.title}`);
      lines.push(`    Reason: ${p.reason}`);
      lines.push(`    Expected effect: ${p.expected_effect}`);
      lines.push(`    Rollback: ${p.rollback_guidance}`);
      lines.push(`    Capability: ${p.capability_id} — not executed`);
      lines.push("");
    }
  }

  lines.push(`  ${REMEDIATION_PROPOSALS_DISCLAIMER}`);
  lines.push(
    "  Capability bounds future execution class — resolution and execution remain blocked.",
  );
  lines.push("");

  return lines.join("\n");
}
