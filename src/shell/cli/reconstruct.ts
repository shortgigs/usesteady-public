/**
 * usesteady reconstruct — UCP-root-driven run reconstruction (SSOT P1).
 *
 * Read-only. Answers: given ucp_root_id + store, what happened?
 * Contract: docs/product/USESTEADY_RECONSTRUCT_COMMAND_V1.md
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { computeChainVerification } from "../../ucp/chain-verification.js";
import type { ChainVerification } from "../../ucp/chain-verification.js";
import { ensureUcpIntentRoot } from "../../ucp/ensure-intent-root.js";
import { getEnvelopeById, getChain } from "../../ucp/persistence/query.js";
import type { IntentPayload } from "../../ucp/types.js";
import { getWorkflowAuditRecord, getWorkflowHistories } from "../../history/workflow-history.js";
import { listWorkflowRunEnvelopes } from "../../history/execution-instance-resolve.js";
import { buildSessionChain } from "../../history/session-chain.js";
import { getByType } from "../../ucp/persistence/index.js";
import type { WorkflowRunPayload } from "../../ucp/types.js";
import { DEFAULT_STORE_DIR, resolveStoreDir } from "../defaults.js";
import { KERNEL_REPLAY_DIRNAME } from "../../kernel/persist.js";
import {
  renderReconstructHelpText,
  renderReconstructJson,
  renderReconstructText,
} from "../reconstruct-render.js";

export type ReconstructOutputFormat = "text" | "json";

export type ReconstructCommandArgs =
  | { readonly mode: "help" }
  | { readonly mode: "reconstruct"; readonly ucpRootId: string };

export type ReconstructChainEntry = {
  readonly id: string;
  readonly type: string;
  readonly ts: number;
};

export type ReconstructWorkflowTaskSummary = {
  readonly taskIndex: number;
  readonly outcome: string;
  readonly input: string | null;
};

export type ReconstructWorkflowSummary = {
  readonly workflowRunId: string;
  readonly workflowName: string;
  readonly finalOutcome: "completed" | "stopped";
  readonly taskCount: number;
  readonly tasks: readonly ReconstructWorkflowTaskSummary[];
};

export type ReconstructReplayStatus = {
  readonly checksum: string | null;
  readonly artifactPath: string | null;
  readonly artifactPresent: boolean;
  readonly replayReportVerdict: string | null;
};

export type ReconstructReport = {
  readonly schema: "usesteady.reconstruct.v1";
  readonly ucp_root_id: string;
  readonly store_dir: string;
  readonly store_dir_ephemeral: boolean;
  readonly status: "complete" | "partial" | "not_found";
  readonly intent_input: string | null;
  readonly chain: {
    readonly envelope_count: number;
    readonly entries: readonly ReconstructChainEntry[];
  };
  readonly chain_verification: ChainVerification | null;
  readonly workflow: ReconstructWorkflowSummary | null;
  readonly replay: ReconstructReplayStatus | null;
  readonly gaps: readonly string[];
};

export function resolveReconstructStoreDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveStoreDir(env);
}

export function isEphemeralStoreDir(storeDir: string): boolean {
  return storeDir === DEFAULT_STORE_DIR;
}

export function parseReconstructArgs(argv: readonly string[]): ReconstructCommandArgs | "usage-error" {
  let help = false;
  let ucpRootId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]!;
    if (tok === "--help" || tok === "-h") {
      help = true;
      continue;
    }
    if (tok === "--ucp-root-id") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) return "usage-error";
      ucpRootId = next;
      i += 1;
      continue;
    }
    if (tok.startsWith("--ucp-root-id=")) {
      const value = tok.slice("--ucp-root-id=".length);
      if (value.length === 0) return "usage-error";
      ucpRootId = value;
      continue;
    }
    if (tok.startsWith("-")) return "usage-error";
    if (ucpRootId !== undefined) return "usage-error";
    ucpRootId = tok;
  }

  if (help) return { mode: "help" };
  if (ucpRootId === undefined || ucpRootId.trim().length === 0) return "usage-error";
  return { mode: "reconstruct", ucpRootId: ucpRootId.trim() };
}

function primaryTaskInputFromPayload(p: WorkflowRunPayload): string {
  const fromInputs = p.taskInputs?.find(
    (input) => typeof input === "string" && input.trim().length > 0,
  );
  return fromInputs?.trim() ?? "";
}

function resolveUcpRootForWorkflowPayload(
  storeDir: string,
  p: WorkflowRunPayload,
): string | null {
  for (const ref of p.sessionRefs) {
    if (typeof ref.intentId === "string" && ref.intentId.length > 0) {
      if (getEnvelopeById(storeDir, ref.intentId) !== null) {
        return ref.intentId;
      }
    }
  }

  const input = primaryTaskInputFromPayload(p);
  if (input.length === 0) return null;
  const ensured = ensureUcpIntentRoot(storeDir, input).ucpRootId;
  return getEnvelopeById(storeDir, ensured) !== null ? ensured : null;
}

function workflowPayloadReferencesUcpRoot(
  storeDir: string,
  p: WorkflowRunPayload,
  ucpRootId: string,
): boolean {
  if (p.sessionRefs.some((ref) => ref.intentId === ucpRootId)) return true;
  const derived = resolveUcpRootForWorkflowPayload(storeDir, p);
  return derived === ucpRootId;
}

function findWorkflowRunIdForIntentRoot(storeDir: string, intentRootId: string): string | null {
  let envelopes: ReturnType<typeof getByType>;
  try {
    envelopes = getByType(storeDir, "ucp.workflow_run.v1");
  } catch {
    return null;
  }

  let bestRunId: string | null = null;
  let bestTs = -1;

  for (const env of envelopes) {
    if (env.type !== "ucp.workflow_run.v1") continue;
    const p = env.payload as WorkflowRunPayload;
    if (p === null || typeof p !== "object") continue;
    if (!Array.isArray(p.sessionRefs)) continue;
    if (!workflowPayloadReferencesUcpRoot(storeDir, p, intentRootId)) continue;
    if (typeof p.workflowRunId !== "string") continue;
    if (env.ts >= bestTs) {
      bestTs = env.ts;
      bestRunId = p.workflowRunId;
    }
  }
  return bestRunId;
}

function buildWorkflowSummary(
  storeDir: string,
  workflowRunId: string,
): ReconstructWorkflowSummary | null {
  const audit = getWorkflowAuditRecord(storeDir, workflowRunId);
  if (audit === null) return null;
  return {
    workflowRunId: audit.workflowRunId,
    workflowName:  audit.workflowName,
    finalOutcome:  audit.finalOutcome,
    taskCount:     audit.taskCount,
    tasks: audit.tasks.map((t) => ({
      taskIndex: t.taskIndex,
      outcome:   t.outcome,
      input:     t.input,
    })),
  };
}

function buildReplayStatus(
  storeDir: string,
  ucpRootId: string,
): ReconstructReplayStatus | null {
  const chainEnvelopes = getChain(storeDir, ucpRootId);
  const replayEnv = chainEnvelopes.find((env) => env.type === "ucp.replay_report.v1");
  if (replayEnv === undefined) return null;

  const payload = replayEnv.payload as {
    readonly verdict?: string;
    readonly artifactChecksum?: string;
  };
  const checksum = typeof payload.artifactChecksum === "string" && payload.artifactChecksum.length > 0
    ? payload.artifactChecksum
    : null;
  const artifactPath = checksum !== null
    ? join(storeDir, KERNEL_REPLAY_DIRNAME, `${checksum}.artifact.json`)
    : null;
  const artifactPresent = artifactPath !== null && existsSync(artifactPath);

  return {
    checksum,
    artifactPath,
    artifactPresent,
    replayReportVerdict: typeof payload.verdict === "string" ? payload.verdict : null,
  };
}

export function buildReconstructReport(
  storeDir: string,
  ucpRootId: string,
): ReconstructReport {
  const gaps: string[] = [];
  const storeDirEphemeral = isEphemeralStoreDir(storeDir);
  if (storeDirEphemeral) {
    gaps.push("store_dir_ephemeral");
  }

  const rootEnvelope = getEnvelopeById(storeDir, ucpRootId);
  if (rootEnvelope === null) {
    return {
      schema:               "usesteady.reconstruct.v1",
      ucp_root_id:          ucpRootId,
      store_dir:            storeDir,
      store_dir_ephemeral:  storeDirEphemeral,
      status:               "not_found",
      intent_input:         null,
      chain:                { envelope_count: 0, entries: [] },
      chain_verification:   null,
      workflow:             null,
      replay:               null,
      gaps,
    };
  }

  const chainEnvelopes = getChain(storeDir, ucpRootId);
  const entries: ReconstructChainEntry[] = chainEnvelopes.map((env) => ({
    id:   env.id,
    type: env.type,
    ts:   env.ts,
  }));

  if (entries.length === 0) {
    gaps.push("empty_chain");
  }

  const chainVerification = computeChainVerification(chainEnvelopes.map((env) => env.id));
  if (chainVerification === null) {
    gaps.push("no_chain_verification");
  }

  let intentInput: string | null = null;
  const intentEnv = chainEnvelopes.find((env) => env.type === "ucp.intent.v1");
  if (intentEnv !== undefined) {
    const payload = intentEnv.payload as IntentPayload;
    if (typeof payload?.input === "string") {
      intentInput = payload.input;
    }
  }

  const workflowRunId = findWorkflowRunIdForIntentRoot(storeDir, ucpRootId);
  let workflow: ReconstructWorkflowSummary | null = null;
  if (workflowRunId === null) {
    gaps.push("no_workflow_run_link");
  } else {
    workflow = buildWorkflowSummary(storeDir, workflowRunId);
    if (workflow === null) {
      gaps.push("no_workflow_run_link");
    }
  }

  const replay = buildReplayStatus(storeDir, ucpRootId);
  if (replay === null) {
    gaps.push("no_replay_report");
  } else if (replay.checksum !== null && !replay.artifactPresent) {
    gaps.push("replay_artifact_missing");
  }

  // Informational gaps that do not block partial when chain is intact
  const blockingGaps = getBlockingGaps(gaps);

  const status = blockingGaps.length === 0 ? "complete" : "partial";

  return {
    schema:              "usesteady.reconstruct.v1",
    ucp_root_id:         ucpRootId,
    store_dir:           storeDir,
    store_dir_ephemeral: storeDirEphemeral,
    status,
    intent_input:        intentInput,
    chain: {
      envelope_count: entries.length,
      entries,
    },
    chain_verification: chainVerification,
    workflow,
    replay,
    gaps,
  };
}

export type ReconstructRunResult = {
  readonly text?: string;
  readonly json?: string;
  readonly exitCode: number;
};

/** Gaps that may appear in cert output but do not fail reconstruction status. */
export const RECONSTRUCT_INFORMATIONAL_GAP_CODES = [
  "no_replay_report",
] as const;

export type ReconstructInformationalGapCode =
  (typeof RECONSTRUCT_INFORMATIONAL_GAP_CODES)[number];

/**
 * Gaps that fail reconstruction certification (Live Truth gate).
 * Workflow link and durable store are required for cert even when
 * chain-only partial reconstruction is still useful interactively.
 */
export function getBlockingGaps(gaps: readonly string[]): readonly string[] {
  const informational = new Set<string>([
    ...RECONSTRUCT_INFORMATIONAL_GAP_CODES,
  ]);
  return gaps.filter((g) => !informational.has(g));
}

export type ResolvedWorkflowUcpRoot = {
  readonly workflowRunId: string;
  readonly ucpRootId: string;
  readonly workflowName: string;
  readonly finalOutcome: "completed" | "stopped";
};

/** @deprecated alias — prefer ResolvedWorkflowUcpRoot */
export type ResolvedCompletedUcpRoot = ResolvedWorkflowUcpRoot;

/**
 * Resolve the most recent workflow's primary UCP root from the store.
 */
export function resolveLatestWorkflowUcpRoot(
  storeDir: string,
  options?: {
    readonly workflowName?: string;
    readonly finalOutcome?: "completed" | "stopped";
  },
): ResolvedWorkflowUcpRoot | null {
  const nameFilter = options?.workflowName?.trim();
  const outcomeFilter = options?.finalOutcome;
  const histories = getWorkflowHistories(storeDir)
    .filter((h) => outcomeFilter === undefined || h.finalOutcome === outcomeFilter)
    .filter((h) => nameFilter === undefined || nameFilter.length === 0 || h.workflowName === nameFilter)
    .sort((a, b) => b.ts - a.ts);

  for (const h of histories) {
    let envelopes: ReturnType<typeof getByType>;
    try {
      envelopes = getByType(storeDir, "ucp.workflow_run.v1");
    } catch {
      continue;
    }
    const match = envelopes.find(
      (env) =>
        env.type === "ucp.workflow_run.v1"
        && (env.payload as WorkflowRunPayload).workflowRunId === h.workflowRunId,
    );
    if (match === undefined || match.type !== "ucp.workflow_run.v1") continue;

    const p = match.payload as WorkflowRunPayload;
    const ucpRootId = resolveUcpRootForWorkflowPayload(storeDir, p);
    if (ucpRootId === null) continue;

    return {
      workflowRunId: h.workflowRunId,
      ucpRootId,
      workflowName:  h.workflowName,
      finalOutcome:  h.finalOutcome,
    };
  }
  return null;
}

/**
 * Resolve the most recent completed workflow's primary UCP root from the store.
 * Optional workflowName filter for cert runs with a unique spec name.
 */
export function resolveLatestCompletedUcpRoot(
  storeDir: string,
  options?: { readonly workflowName?: string },
): ResolvedWorkflowUcpRoot | null {
  return resolveLatestWorkflowUcpRoot(storeDir, {
    ...options,
    finalOutcome: "completed",
  });
}

export type FailurePathScenario = "failed_execution" | "denied_approval";

export type IntegrityComparison = {
  readonly matches: boolean;
  readonly mismatch_fields: readonly string[];
  readonly recomputed: ChainVerification;
  readonly claimed: ChainVerification;
};

/** Compare recomputed chain verification against a claimed digest block. */
export function compareChainVerification(
  recomputed: ChainVerification,
  claimed: ChainVerification,
): IntegrityComparison {
  const mismatch_fields: string[] = [];
  if (recomputed.cumulative_hash !== claimed.cumulative_hash) {
    mismatch_fields.push("cumulative_hash");
  }
  if (recomputed.merkle_root !== claimed.merkle_root) {
    mismatch_fields.push("merkle_root");
  }
  if (recomputed.entry_ids.length !== claimed.entry_ids.length) {
    mismatch_fields.push("entry_ids.length");
  } else {
    for (let i = 0; i < recomputed.entry_ids.length; i += 1) {
      if (recomputed.entry_ids[i] !== claimed.entry_ids[i]) {
        mismatch_fields.push("entry_ids");
        break;
      }
    }
  }
  return {
    matches: mismatch_fields.length === 0,
    mismatch_fields,
    recomputed,
    claimed,
  };
}

export function explainIntegrityMismatch(comparison: IntegrityComparison): string {
  if (comparison.matches) {
    return "Integrity digest matches the authoritative chain.";
  }
  return `Integrity mismatch: ${comparison.mismatch_fields.join(", ")} differ from recomputed P0-4 digest.`;
}

function assertReconstructableBase(
  report: ReconstructReport,
  reasons: string[],
): void {
  if (report.status === "not_found") {
    reasons.push("reconstruct status is not_found");
  }
  if (report.store_dir_ephemeral) {
    reasons.push("store_dir_ephemeral — set USESTEADY_STORE_DIR to a durable path");
  }
  const blocking = getBlockingGaps(report.gaps);
  if (blocking.length > 0) {
    reasons.push(`blocking gaps: ${blocking.join(", ")}`);
  }
  if (report.chain_verification === null) {
    reasons.push("chain_verification missing");
  } else if (report.chain_verification.entry_ids.length === 0) {
    reasons.push("chain_verification entry_ids empty");
  }
  if (report.workflow === null) {
    reasons.push("workflow link missing");
  }
  if (report.chain.envelope_count === 0) {
    reasons.push("chain envelope_count is zero");
  }
  if (report.intent_input === null || report.intent_input.trim().length === 0) {
    reasons.push("intent_input missing");
  }
}

export function assertFailurePathReconstructReport(
  report: ReconstructReport,
  scenario: FailurePathScenario,
): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  assertReconstructableBase(report, reasons);

  if (report.workflow !== null) {
    if (report.workflow.finalOutcome !== "stopped") {
      reasons.push(`expected finalOutcome stopped, got ${report.workflow.finalOutcome}`);
    }
    const task = report.workflow.tasks[0];
    if (task === undefined) {
      reasons.push("workflow has no tasks");
    } else if (scenario === "failed_execution" && task.outcome !== "stopped") {
      reasons.push(`failed_execution expected task outcome stopped, got ${task.outcome}`);
    } else if (scenario === "denied_approval" && task.outcome !== "rejected") {
      reasons.push(`denied_approval expected task outcome rejected, got ${task.outcome}`);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export type MultiStepGovernanceTaskSummary = {
  readonly taskIndex: number;
  readonly outcome: string;
  readonly intentId: string | null;
  readonly approval_confirmed: boolean | "unknown";
  readonly chain_envelope_count: number | "unknown";
};

export type MultiStepGovernanceAudit = {
  readonly workflow_run_id: string;
  readonly task_count: number;
  readonly tasks_accepted: number;
  readonly intent_backed_tasks: number;
  readonly confirmed_approval_handoffs: number;
  readonly primary_chain_envelope_count: number;
  readonly tasks: readonly MultiStepGovernanceTaskSummary[];
};

/** Audit per-task outcomes and approval evidence for multi-step governance cert. */
export function auditMultiStepGovernance(
  storeDir: string,
  workflowRunId: string,
  primaryChainEnvelopeCount: number,
): MultiStepGovernanceAudit | null {
  const audit = getWorkflowAuditRecord(storeDir, workflowRunId);
  if (audit === null) return null;

  const tasks: MultiStepGovernanceTaskSummary[] = audit.tasks.map((t) => {
    const intentId = t.session?.intentId ?? null;
    let chainEnvelopeCount: number | "unknown" = "unknown";
    let approvalConfirmed: boolean | "unknown" = "unknown";

    if (intentId !== null) {
      const chain = buildSessionChain(storeDir, intentId);
      chainEnvelopeCount = getChain(storeDir, intentId).length;
      const handoff = chain.cursorHandoff?.payload as { confirmedByHuman?: boolean } | undefined;
      approvalConfirmed = handoff?.confirmedByHuman === true;
    } // An accepted outcome without bound evidence does not prove approval.

    return {
      taskIndex:            t.taskIndex,
      outcome:              t.outcome,
      intentId,
      approval_confirmed:   approvalConfirmed,
      chain_envelope_count: chainEnvelopeCount,
    };
  });

  return {
    workflow_run_id:               workflowRunId,
    task_count:                    audit.taskCount,
    tasks_accepted:                tasks.filter((t) => t.outcome === "accepted").length,
    intent_backed_tasks:           tasks.filter((t) => t.intentId !== null).length,
    confirmed_approval_handoffs:   tasks.filter((t) => t.approval_confirmed === true).length,
    primary_chain_envelope_count:  primaryChainEnvelopeCount,
    tasks,
  };
}

export function assertMultiStepCodeChangeCertReport(
  report: ReconstructReport,
  storeDir: string,
  options?: {
    readonly minTasks?: number;
    readonly minChainCount?: number;
    readonly minConfirmedApprovals?: number;
    readonly workflowRunId?: string;
  },
): { readonly ok: true; readonly governance: MultiStepGovernanceAudit }
  | { readonly ok: false; readonly reasons: readonly string[] } {
  const minTasks = options?.minTasks ?? 3;
  const minChainCount = options?.minChainCount ?? 3;
  const minConfirmedApprovals = options?.minConfirmedApprovals ?? 3;
  const reasons: string[] = [];

  assertReconstructableBase(report, reasons);

  if (report.status !== "complete") {
    reasons.push(`reconstruct status is ${report.status}, expected complete`);
  }

  if (report.chain.envelope_count < minChainCount) {
    reasons.push(
      `chain_count ${report.chain.envelope_count} < ${minChainCount} — governance evidence chain too short`,
    );
  }

  if (report.chain_verification === null) {
    reasons.push("integrity verification missing (chain_verification null)");
  } else if (report.chain_verification.entry_ids.length < minChainCount) {
    reasons.push(
      `integrity entry_ids length ${report.chain_verification.entry_ids.length} < ${minChainCount}`,
    );
  }

  if (report.workflow === null) {
    reasons.push("workflow link missing — reconstruction incomplete");
  } else {
    if (report.workflow.finalOutcome !== "completed") {
      reasons.push(`final state is ${report.workflow.finalOutcome}, expected completed`);
    }
    if (report.workflow.taskCount < minTasks) {
      reasons.push(`workflow taskCount ${report.workflow.taskCount} < ${minTasks}`);
    }
    if (report.workflow.tasks.length < minTasks) {
      reasons.push(`reconstruct shows ${report.workflow.tasks.length} tasks, need ${minTasks}`);
    }
    for (let i = 0; i < minTasks; i += 1) {
      const task = report.workflow.tasks[i];
      if (task === undefined) {
        reasons.push(`task ${i + 1} missing from reconstruction`);
      } else if (task.outcome !== "accepted") {
        reasons.push(`task ${i + 1} outcome is ${task.outcome}, expected accepted`);
      }
    }
  }

  const workflowRunId = options?.workflowRunId ?? report.workflow?.workflowRunId;
  if (workflowRunId === undefined) {
    reasons.push("cannot audit governance without workflow_run_id");
    return reasons.length === 0
      ? { ok: false, reasons: ["governance audit impossible"] }
      : { ok: false, reasons };
  }

  const governance = auditMultiStepGovernance(
    storeDir,
    workflowRunId,
    report.chain.envelope_count,
  );
  if (governance === null) {
    reasons.push("governance audit record missing");
    return { ok: false, reasons };
  }

  if (governance.confirmed_approval_handoffs < minConfirmedApprovals) {
    reasons.push(
      `approval chain incomplete: ${governance.confirmed_approval_handoffs} confirmed approvals ` +
        `< ${minConfirmedApprovals} required (one per task)`,
    );
  }

  if (governance.intent_backed_tasks < 2) {
    reasons.push(
      `expected at least 2 intent-backed replace tasks, got ${governance.intent_backed_tasks}`,
    );
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, governance };
}

export function assertReconstructionCertReport(
  report: ReconstructReport,
): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  assertReconstructableBase(report, reasons);

  if (report.workflow !== null && report.workflow.finalOutcome !== "completed") {
    reasons.push(`workflow finalOutcome is ${report.workflow.finalOutcome}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export function runReconstruct(
  args: ReconstructCommandArgs,
  storeDir: string = resolveReconstructStoreDir(),
  format: ReconstructOutputFormat = "text",
): ReconstructRunResult {
  if (args.mode === "help") {
    const help = renderReconstructHelpText();
    return format === "json"
      ? { json: JSON.stringify({ help }) + "\n", exitCode: 0 }
      : { text: help, exitCode: 0 };
  }

  const report = buildReconstructReport(storeDir, args.ucpRootId);
  const exitCode = report.status === "not_found" ? 1 : 0;

  if (format === "json") {
    return { json: renderReconstructJson(report), exitCode };
  }
  return { text: renderReconstructText(report), exitCode };
}

/** Test helper: list intent roots from recent workflow runs when ucp_root_id unknown. */
export function listKnownUcpRoots(storeDir: string): readonly string[] {
  const roots = new Set<string>();
  // Discovery only: raw references do not bind these roots to an execution.
  for (const envelope of listWorkflowRunEnvelopes(storeDir)) {
    for (const ref of envelope.payload.sessionRefs) {
      if (typeof ref.intentId === "string" && ref.intentId.length > 0) roots.add(ref.intentId);
    }
  }
  return [...roots];
}
