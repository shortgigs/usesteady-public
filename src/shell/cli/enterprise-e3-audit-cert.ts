/**
 * E3 — Audit Retention & Export certification helpers.
 *
 * Contract: docs/product/E3_AUDIT_RETENTION_AND_EXPORT_CERT_V1.md
 *
 * Primary export path: reconstruct JSON for a B6/B7 reference run.
 * Reuses B7 verify/tamper tooling — does not reopen B7 charter.
 */

import { readFileSync } from "node:fs";

import type { ChainVerification } from "../../ucp/chain-verification.js";
import {
  buildReconstructReport,
  type ReconstructReport,
} from "./reconstruct.js";
import {
  simulatePortalTamperDetection,
  verifyPortalChainIntegrity,
  type IntegrityVerifyResult,
  type TamperDetectResult,
} from "./portal-projection-cert.js";

export type E3ReferenceRunManifest = {
  readonly artifact: string;
  readonly source: string;
  readonly store_dir_hint: string;
  readonly ucp_root_id: string;
  readonly workflow_run_id: string;
  readonly portal_workflow_id?: string;
  readonly export_command: string;
};

export type E3ExportResult =
  | {
      readonly ok: true;
      readonly report: ReconstructReport;
      readonly exportJson: string;
    }
  | { readonly ok: false; readonly reason: string };

export type RetentionPolicyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: readonly string[] };

const RETENTION_REQUIRED_HEADINGS = [
  "minimum retention period",
  "storage owner",
  "scope",
  "deletion",
  "purge",
] as const;

/** Load frozen B6/B7 reference manifest from disk. */
export function loadE3ReferenceManifest(manifestPath: string): E3ReferenceRunManifest {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as E3ReferenceRunManifest;
  if (!raw.ucp_root_id || raw.ucp_root_id.length !== 64) {
    throw new Error("E3 reference manifest: invalid ucp_root_id");
  }
  if (!raw.workflow_run_id) {
    throw new Error("E3 reference manifest: missing workflow_run_id");
  }
  return raw;
}

/** Export reconstruct JSON audit evidence for the reference run. */
export function exportReconstructAuditEvidence(
  storeDir: string,
  ucpRootId: string,
): E3ExportResult {
  const report = buildReconstructReport(storeDir, ucpRootId);

  if (report.status === "not_found") {
    return { ok: false, reason: "reconstruct status not_found — store missing ucp_root" };
  }
  if (!report.chain_verification) {
    return { ok: false, reason: "export missing chain_verification" };
  }
  if (report.chain.entries.length === 0) {
    return { ok: false, reason: "export chain is empty" };
  }

  const exportJson = JSON.stringify(report, null, 2);
  return { ok: true, report, exportJson };
}

/** Offline integrity verify on exported chain_verification (E3-3). */
export function verifyExportedAuditIntegrity(
  chainVerification: ChainVerification | null,
): IntegrityVerifyResult {
  return verifyPortalChainIntegrity(chainVerification);
}

/** In-memory tamper drill on exported chain_verification (E3-4). */
export function runAuditExportTamperDrill(
  chainVerification: ChainVerification,
): TamperDetectResult {
  return simulatePortalTamperDetection(chainVerification);
}

/** Validate retention policy markdown includes minimum schema fields (E3-5). */
export function validateRetentionPolicyMarkdown(content: string): RetentionPolicyValidation {
  const lower = content.toLowerCase();
  const missing: string[] = [];

  for (const heading of RETENTION_REQUIRED_HEADINGS) {
    if (!lower.includes(heading)) {
      missing.push(heading);
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

/** Assert export report matches reference workflow linkage. */
export function assertE3ReferenceRunReady(
  report: ReconstructReport,
  manifest: E3ReferenceRunManifest,
): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] } {
  const reasons: string[] = [];

  if (report.ucp_root_id !== manifest.ucp_root_id) {
    reasons.push("ucp_root_id mismatch vs reference manifest");
  }
  if (!report.workflow || report.workflow.workflowRunId !== manifest.workflow_run_id) {
    reasons.push(
      `workflow_run_id mismatch: expected ${manifest.workflow_run_id}, got ${report.workflow?.workflowRunId ?? "null"}`,
    );
  }
  if (report.status !== "complete" && report.status !== "partial") {
    reasons.push(`unexpected reconstruct status: ${report.status}`);
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true };
}
