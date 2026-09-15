/**
 * PHASE2_B7_PORTAL_PROJECTION_CERT_V1 — projection consistency helpers.
 *
 * Authoritative source: `buildReconstructReport` (Core reconstruction).
 * Derived source: Portal ingest row (`portal_workflow_runs`).
 *
 * The primary assert compares Portal projection TO authoritative reconstruction —
 * never reconstruction against itself.
 */

import {
  computeChainVerification,
  type ChainVerification,
} from "../../ucp/chain-verification.js";
import { deliveryReportSummaryFromOutcomes } from "../../portal-bridge/execution-return/report-run.js";
import type {
  ExecutionReturnDecisionSummary,
  ExecutionReturnDeliveryReportSummary,
} from "../../portal-bridge/execution-return/types.js";
import { compareChainVerification, type ReconstructReport } from "./reconstruct.js";

/** Material facts limited to B7 charter — no semantic expansion. */
export type MaterialFacts = {
  readonly ucp_root_id: string;
  readonly run_id: string;
  readonly task_count: number;
  readonly task_outcomes: readonly string[];
  readonly workflow_status: string;
  readonly chain_digest: string | null;
};

export type PortalIngestRow = {
  readonly ucp_root_id: string;
  readonly run_id: string;
  readonly outcome: string;
  readonly decision_summary: ExecutionReturnDecisionSummary;
  readonly delivery_report_summary?: ExecutionReturnDeliveryReportSummary;
  readonly chain_verification: ChainVerification | null;
  /** Independently stored declared count. Never synthesized from entry_ids. */
  readonly chain_count: number | null;
};

export type PortalMaterialFactsResult =
  | { readonly ok: true; readonly facts: MaterialFacts }
  | { readonly ok: false; readonly reason: string };

export type ProjectionConsistencyResult =
  | { readonly ok: true; readonly authoritative: MaterialFacts; readonly portal: MaterialFacts }
  | { readonly ok: false; readonly reasons: readonly string[] };

export type IntegrityVerifyResult =
  | { readonly ok: true; readonly verified: true }
  | { readonly ok: false; readonly verified: false; readonly reason: string };

export type TamperDetectResult =
  | { readonly ok: true; readonly detects_mismatch: true }
  | { readonly ok: false; readonly detects_mismatch: false; readonly reason: string };

export type SnapshotReconciliationResult =
  | {
      readonly ok: true;
      readonly snapshot: ChainVerification;
      readonly authoritativeDigest: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Certification-only: the reported snapshot must be the exact root-prefixed
 * ordered prefix of later reconstruction. Later appends may follow; they
 * must not rewrite the certified set.
 */
export function reconcileReportedChainSnapshot(input: {
  readonly reported: ChainVerification | null | undefined;
  readonly reconstructedEntryIds: readonly string[];
  readonly ucpRootId: string;
  readonly reportedCount?: number | null;
}): SnapshotReconciliationResult {
  const reported = input.reported;
  if (!reported || !Array.isArray(reported.entry_ids) || reported.entry_ids.length === 0) {
    return { ok: false, reason: "no admissible reported chain snapshot" };
  }

  const reportedIds = reported.entry_ids;
  if (reportedIds[0] !== input.ucpRootId) {
    return { ok: false, reason: "reported snapshot first id is not ucp_root_id" };
  }
  if (
    typeof input.reportedCount !== "number" ||
    !Number.isInteger(input.reportedCount) ||
    input.reportedCount < 0 ||
    input.reportedCount !== reportedIds.length
  ) {
    return { ok: false, reason: "reported snapshot count does not equal ordered id count" };
  }

  const seen = new Set<string>();
  for (const id of reportedIds) {
    if (typeof id !== "string" || id.trim().length === 0) {
      return { ok: false, reason: "reported snapshot contains an empty id" };
    }
    if (seen.has(id)) {
      return { ok: false, reason: "reported snapshot contains a duplicate id" };
    }
    seen.add(id);
  }

  const reconstructed = input.reconstructedEntryIds;
  if (reconstructed.length < reportedIds.length) {
    return { ok: false, reason: "reconstruction is shorter than the reported snapshot" };
  }

  const reconstructedIndex = new Map<string, number[]>();
  for (let i = 0; i < reconstructed.length; i += 1) {
    const id = reconstructed[i]!;
    const list = reconstructedIndex.get(id) ?? [];
    list.push(i);
    reconstructedIndex.set(id, list);
  }

  for (const id of reportedIds) {
    const occurrences = reconstructedIndex.get(id);
    if (!occurrences || occurrences.length !== 1) {
      return { ok: false, reason: "reported id is missing, substituted, or duplicated in reconstruction" };
    }
  }

  for (let i = 0; i < reportedIds.length; i += 1) {
    if (reconstructed[i] !== reportedIds[i]) {
      return { ok: false, reason: "reported snapshot is not an exact ordered prefix of reconstruction" };
    }
  }

  const recomputed = computeChainVerification(reportedIds);
  if (!recomputed) {
    return { ok: false, reason: "could not recompute reported snapshot verification" };
  }

  const comparison = compareChainVerification(recomputed, reported);
  if (!comparison.matches) {
    return {
      ok: false,
      reason: `reported snapshot digest mismatch: ${comparison.mismatch_fields.join(", ")}`,
    };
  }

  return {
    ok: true,
    snapshot: reported,
    authoritativeDigest: recomputed.cumulative_hash,
  };
}

export function applyReconciledSnapshotDigest(
  facts: MaterialFacts,
  authoritativeDigest: string,
): MaterialFacts {
  return {
    ...facts,
    chain_digest: authoritativeDigest,
  };
}

/** Map reconstruct workflow final outcome to execution-return wire outcome. */
export function wireOutcomeFromFinalOutcome(
  finalOutcome: string | null | undefined,
  taskOutcomes: readonly string[],
): "success" | "failure" | "partial" {
  if (finalOutcome === "completed") {
    return "success";
  }
  const anyFailed = taskOutcomes.some(
    (o) => o === "rejected" || o === "stopped",
  );
  if (anyFailed) {
    return "failure";
  }
  return "partial";
}

function outcomeCounts(outcomes: readonly string[]): {
  accepted: number;
  rejected: number;
  skipped: number;
} {
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o === "accepted") accepted += 1;
    else if (o === "rejected") rejected += 1;
    else if (o === "skipped" || o === "skipped_by_intake") skipped += 1;
  }
  return { accepted, rejected, skipped };
}

/** Authoritative material facts from Core reconstruction. */
export function authoritativeMaterialFactsFromReconstruct(
  report: ReconstructReport,
  ucpRootId: string,
  workflowRunId: string,
): MaterialFacts | null {
  const wf = report.workflow;
  if (!wf) {
    return null;
  }

  const taskOutcomes = wf.tasks.map((t) => t.outcome);
  const wireOutcome = wireOutcomeFromFinalOutcome(wf.finalOutcome, taskOutcomes);

  return {
    ucp_root_id: ucpRootId,
    run_id: workflowRunId,
    task_count: wf.tasks.length,
    task_outcomes: taskOutcomes,
    workflow_status: wireOutcome,
    chain_digest: report.chain_verification?.cumulative_hash ?? null,
  };
}

/**
 * Derived material facts from Portal ingest row.
 * Delivery outcomes come ONLY from `delivery_report_summary`.
 * Never reconstruct `accepted` from `decision_summary.approved`.
 * Legacy rows lacking the additive summary fail closed.
 */
export function portalMaterialFactsFromIngestRow(
  row: PortalIngestRow,
): PortalMaterialFactsResult {
  const drs = row.delivery_report_summary;
  if (!drs || drs.basis !== "executor_delivery_report") {
    return {
      ok: false,
      reason:
        "delivery_report_summary_unavailable: cannot reconstruct delivery outcomes from decision_summary.approved",
    };
  }

  const taskOutcomes: string[] = [];
  for (let i = 0; i < drs.accepted; i += 1) taskOutcomes.push("accepted");
  for (let i = 0; i < drs.rejected; i += 1) taskOutcomes.push("rejected");
  for (let i = 0; i < drs.skipped; i += 1) taskOutcomes.push("skipped");
  for (let i = 0; i < drs.pending; i += 1) taskOutcomes.push("pending");
  for (let i = 0; i < drs.stopped; i += 1) taskOutcomes.push("stopped");
  for (let i = 0; i < drs.other; i += 1) taskOutcomes.push("other");

  return {
    ok: true,
    facts: {
      ucp_root_id: row.ucp_root_id,
      run_id: row.run_id,
      task_count: drs.total,
      task_outcomes: taskOutcomes,
      workflow_status: row.outcome,
      chain_digest: row.chain_verification?.cumulative_hash ?? null,
    },
  };
}

/**
 * Primary Track B assertion: Portal projection must match authoritative
 * reconstruction on material facts.
 */
export function assertPortalProjectionMatchesAuthoritative(
  authoritative: MaterialFacts,
  portal: MaterialFacts,
): ProjectionConsistencyResult {
  const reasons: string[] = [];

  if (authoritative.ucp_root_id !== portal.ucp_root_id) {
    reasons.push(
      `ucp_root_id: authoritative=${authoritative.ucp_root_id.slice(0, 16)}… portal=${portal.ucp_root_id.slice(0, 16)}…`,
    );
  }
  if (authoritative.run_id !== portal.run_id) {
    reasons.push(`run_id: authoritative=${authoritative.run_id} portal=${portal.run_id}`);
  }
  if (authoritative.task_count !== portal.task_count) {
    reasons.push(
      `task_count: authoritative=${authoritative.task_count} portal=${portal.task_count}`,
    );
  }
  if (authoritative.workflow_status !== portal.workflow_status) {
    reasons.push(
      `workflow_status: authoritative=${authoritative.workflow_status} portal=${portal.workflow_status}`,
    );
  }
  if (authoritative.chain_digest !== portal.chain_digest) {
    reasons.push(
      `chain_digest: authoritative=${authoritative.chain_digest ?? "null"} portal=${portal.chain_digest ?? "null"}`,
    );
  }

  const authCounts = outcomeCounts(authoritative.task_outcomes);
  const portalCounts = outcomeCounts(portal.task_outcomes);
  if (authCounts.accepted !== portalCounts.accepted) {
    reasons.push(
      `accepted tasks: authoritative=${authCounts.accepted} portal=${portalCounts.accepted}`,
    );
  }
  if (authCounts.rejected !== portalCounts.rejected) {
    reasons.push(
      `rejected tasks: authoritative=${authCounts.rejected} portal=${portalCounts.rejected}`,
    );
  }
  if (authCounts.skipped !== portalCounts.skipped) {
    reasons.push(
      `skipped tasks: authoritative=${authCounts.skipped} portal=${portalCounts.skipped}`,
    );
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, authoritative, portal };
}

/** Precondition: reconstruct report is complete enough to certify B7. */
export function assertAuthoritativeReconstructReady(
  report: ReconstructReport,
  ucpRootId: string,
  workflowRunId: string,
): ProjectionConsistencyResult | { readonly ok: true; readonly authoritative: MaterialFacts } {
  const reasons: string[] = [];

  if (report.status !== "complete") {
    reasons.push(`reconstruct status is ${report.status}, expected complete`);
  }

  const authoritative = authoritativeMaterialFactsFromReconstruct(
    report,
    ucpRootId,
    workflowRunId,
  );
  if (!authoritative) {
    return { ok: false, reasons: ["reconstruct report missing workflow section"] };
  }

  if (authoritative.task_count < 3) {
    reasons.push(`expected >= 3 tasks, got ${authoritative.task_count}`);
  }
  if (authoritative.workflow_status !== "success") {
    reasons.push(
      `expected workflow_status success, got ${authoritative.workflow_status}`,
    );
  }
  if (!authoritative.chain_digest) {
    reasons.push("chain_digest missing on authoritative reconstruct");
  }

  const expectedDelivery = deliveryReportSummaryFromOutcomes(authoritative.task_outcomes);
  if (expectedDelivery.total !== authoritative.task_count) {
    reasons.push("authoritative task_count inconsistent with task_outcomes");
  }

  const accepted = authoritative.task_outcomes.filter((o) => o === "accepted").length;
  if (accepted < 3) {
    reasons.push(`expected 3 accepted tasks for B6 artifact, got ${accepted}`);
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, authoritative };
}

/**
 * P0-57 offline verify: recompute digest from stored entry_ids and compare
 * to published chain_verification on the Portal row (Verify → Verified).
 */
export function verifyPortalChainIntegrity(
  chainVerification: ChainVerification | null,
): IntegrityVerifyResult {
  if (!chainVerification) {
    return { ok: false, verified: false, reason: "portal row missing chain_verification" };
  }
  if (!Array.isArray(chainVerification.entry_ids) || chainVerification.entry_ids.length === 0) {
    return { ok: false, verified: false, reason: "portal chain_verification missing entry_ids" };
  }

  const recomputed = computeChainVerification(chainVerification.entry_ids);
  if (!recomputed) {
    return { ok: false, verified: false, reason: "could not recompute chain integrity" };
  }

  const comparison = compareChainVerification(recomputed, chainVerification);
  if (!comparison.matches) {
    return {
      ok: false,
      verified: false,
      reason: `integrity mismatch: ${comparison.mismatch_fields.join(", ")}`,
    };
  }

  return { ok: true, verified: true };
}

/**
 * Tamper drill (in-memory): corrupt published merkle_root and confirm detection
 * (Tamper → Mismatch). Does not mutate production storage.
 */
export function simulatePortalTamperDetection(
  chainVerification: ChainVerification,
): TamperDetectResult {
  const recomputed = computeChainVerification(chainVerification.entry_ids);
  if (!recomputed) {
    return { ok: false, detects_mismatch: false, reason: "could not recompute chain integrity" };
  }

  const tampered: ChainVerification = {
    ...chainVerification,
    merkle_root: chainVerification.merkle_root.replace(/^./, "f"),
  };

  const comparison = compareChainVerification(recomputed, tampered);
  if (comparison.matches) {
    return {
      ok: false,
      detects_mismatch: false,
      reason: "tampered merkle_root still reported as matching",
    };
  }

  return { ok: true, detects_mismatch: true };
}

/** Parse a Supabase REST row into PortalIngestRow. */
export function parsePortalIngestRow(raw: unknown): PortalIngestRow | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const ds = row.decision_summary;
  if (typeof ds !== "object" || ds === null) {
    return null;
  }
  const summary = ds as Record<string, unknown>;
  const cvRaw = row.chain_verification;
  let chainVerification: ChainVerification | null = null;
  if (typeof cvRaw === "object" && cvRaw !== null) {
    const cv = cvRaw as Record<string, unknown>;
    if (
      Array.isArray(cv.entry_ids) &&
      typeof cv.cumulative_hash === "string" &&
      typeof cv.merkle_root === "string"
    ) {
      chainVerification = {
        entry_ids: cv.entry_ids as string[],
        cumulative_hash: cv.cumulative_hash,
        merkle_root: cv.merkle_root,
        algorithm: "sha256",
      };
    }
  }

  if (
    typeof row.ucp_root_id !== "string" ||
    typeof row.run_id !== "string" ||
    typeof row.outcome !== "string" ||
    typeof summary.total_steps !== "number"
  ) {
    return null;
  }

  const drsRaw = row.delivery_report_summary;
  let deliveryReportSummary: ExecutionReturnDeliveryReportSummary | undefined;
  if (typeof drsRaw === "object" && drsRaw !== null) {
    const drs = drsRaw as Record<string, unknown>;
    if (
      drs.basis === "executor_delivery_report" &&
      typeof drs.total === "number" &&
      typeof drs.accepted === "number" &&
      typeof drs.rejected === "number" &&
      typeof drs.skipped === "number" &&
      typeof drs.pending === "number" &&
      typeof drs.stopped === "number" &&
      typeof drs.other === "number"
    ) {
      deliveryReportSummary = {
        basis: "executor_delivery_report",
        total: drs.total,
        accepted: drs.accepted,
        rejected: drs.rejected,
        skipped: drs.skipped,
        pending: drs.pending,
        stopped: drs.stopped,
        other: drs.other,
      };
    }
  }

  return {
    ucp_root_id: row.ucp_root_id,
    run_id: row.run_id,
    outcome: row.outcome,
    decision_summary: {
      total_steps: summary.total_steps as number,
      approved: (summary.approved as number) ?? 0,
      rejected: (summary.rejected as number) ?? 0,
      executed: (summary.executed as number) ?? 0,
      skipped: (summary.skipped as number) ?? 0,
      break_glass: (summary.break_glass as boolean) ?? false,
    },
    ...(deliveryReportSummary ? { delivery_report_summary: deliveryReportSummary } : {}),
    chain_verification: chainVerification,
    chain_count:
      typeof row.chain_count === "number" &&
      Number.isInteger(row.chain_count) &&
      row.chain_count >= 0
        ? row.chain_count
        : null,
  };
}

/** Cert-only fetch: optional TLS bypass for Windows operator environments. */
async function certFetch(url: string, init: RequestInit): Promise<Response> {
  if (process.env.USESTEADY_CERT_INSECURE_TLS === "1") {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      return await fetch(url, init);
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
      }
    }
  }
  return fetch(url, init);
}

export async function fetchPortalIngestRow(input: {
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly organizationId: string;
  readonly runId: string;
  readonly maxWaitMs?: number;
}): Promise<PortalIngestRow | null> {
  const deadline = Date.now() + (input.maxWaitMs ?? 30_000);
  const base = input.supabaseUrl.replace(/\/$/, "");
  const url =
    `${base}/rest/v1/portal_workflow_runs` +
    `?organization_id=eq.${encodeURIComponent(input.organizationId)}` +
    `&run_id=eq.${encodeURIComponent(input.runId)}` +
    "&select=ucp_root_id,run_id,outcome,decision_summary,delivery_report_summary,chain_verification,chain_count" +
    "&limit=1";

  while (Date.now() < deadline) {
    const res = await certFetch(url, {
      headers: {
        apikey: input.serviceKey,
        Authorization: `Bearer ${input.serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`portal_workflow_runs fetch failed: HTTP ${res.status}`);
    }
    const rows = (await res.json()) as unknown[];
    if (Array.isArray(rows) && rows.length > 0) {
      const parsed = parsePortalIngestRow(rows[0]);
      if (parsed) {
        return parsed;
      }
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  return null;
}

export async function fetchPortalWorkflowLinked(input: {
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly ucpRootId: string;
}): Promise<boolean> {
  const base = input.supabaseUrl.replace(/\/$/, "");
  const url =
    `${base}/rest/v1/portal_workflows` +
    `?ucp_root_id=eq.${encodeURIComponent(input.ucpRootId)}` +
    "&select=id&limit=1";

  const res = await certFetch(url, {
    headers: {
      apikey: input.serviceKey,
      Authorization: `Bearer ${input.serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`portal_workflows fetch failed: HTTP ${res.status}`);
  }
  const rows = (await res.json()) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}
