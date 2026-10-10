/**
 * E6 — Operational Recovery certification helpers.
 *
 * Contract: docs/product/E6_OPERATIONAL_RECOVERY_CERT_V1.md
 *
 * Primary path: file-copy restore of durable store to clean target,
 * then post-restore reconstruct on B6/B7 reference run (same manifest as E3).
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";

import {
  assertE3ReferenceRunReady,
  loadE3ReferenceManifest,
  type E3ReferenceRunManifest,
} from "./enterprise-e3-audit-cert.js";
import { buildReconstructReport, type ReconstructReport } from "./reconstruct.js";

export { loadE3ReferenceManifest, type E3ReferenceRunManifest };

export type RecoveryPolicyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: readonly string[] };

export type RestoreDrillResult =
  | { readonly ok: true; readonly targetDir: string }
  | { readonly ok: false; readonly reason: string };

export type PostRecoveryReconstructResult =
  | { readonly ok: true; readonly report: ReconstructReport }
  | { readonly ok: false; readonly reasons: readonly string[] };

const POLICY_REQUIRED_HEADINGS = [
  "rpo",
  "rto",
  "recovery source",
  "recovery owner",
  "recovery procedure",
] as const;

const NUMERIC_RPO_RTO = /\d+\s*(hour|hours|hr|h|day|days|d)\b/i;

/** Validate recovery policy markdown includes minimum schema fields (E6-1..3). */
export function validateRecoveryPolicyMarkdown(content: string): RecoveryPolicyValidation {
  const lower = content.toLowerCase();
  const missing: string[] = [];

  for (const heading of POLICY_REQUIRED_HEADINGS) {
    if (!lower.includes(heading)) {
      missing.push(heading);
    }
  }

  if (!NUMERIC_RPO_RTO.test(content)) {
    missing.push("numeric RPO or RTO");
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

/**
 * E6 restore drill: copy recovery source to a clean target directory.
 * Does not mutate the source store.
 */
export function restoreStoreFromRecoverySource(
  sourceDir: string,
  targetDir: string,
): RestoreDrillResult {
  if (!existsSync(sourceDir)) {
    return { ok: false, reason: `recovery source not found: ${sourceDir}` };
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });

  return { ok: true, targetDir };
}

/** Post-recovery reconstruct on B6/B7 reference run (E6-5). */
export function assertPostRecoveryReconstruct(
  restoredStoreDir: string,
  manifest: E3ReferenceRunManifest,
): PostRecoveryReconstructResult {
  const report = buildReconstructReport(restoredStoreDir, manifest.ucp_root_id);
  const reasons: string[] = [];

  if (report.status === "not_found") {
    reasons.push("reconstruct not_found after recovery — store missing ucp_root");
  } else if (report.status !== "complete") {
    reasons.push(`expected reconstruct complete after recovery, got ${report.status}`);
    if (report.gaps.length > 0) {
      reasons.push(`gaps: ${report.gaps.join(", ")}`);
    }
  }

  const linkage = assertE3ReferenceRunReady(report, manifest);
  if (!linkage.ok) {
    reasons.push(...linkage.reasons);
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true, report };
}
