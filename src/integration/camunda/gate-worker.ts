import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveLatestCompletedUcpRoot } from "../../shell/cli/reconstruct.js";
import {
  buildApprovedActionRecord,
  writeApprovedActionRecord,
} from "./approved-action.js";
import { CamundaRestClient } from "./camunda-rest-client.js";
import {
  JOB_TYPE_ENTERPRISE_ACTION,
  JOB_TYPE_INVOKE_GATE,
  PROCESS_DEFINITION_KEY,
} from "./constants.js";
import {
  captureCamundaPhase1Evidence,
  isBaselineSealed,
  sealCamundaAloneBaseline,
} from "./evidence-capture.js";
import { buildGateWorkflowSpec } from "./gate-workflow-spec.js";
import type { CamundaJob, GateRunResult } from "./types.js";

export type GateWorkerConfig = {
  readonly storeDir: string;
  readonly repoRoot: string;
  readonly camunda: CamundaRestClient;
  readonly portalRunsUrl: string;
  readonly portalApprovalsUrl: string;
  readonly portalToken: string;
  readonly stamp: string;
};

type ApprovalRecord = {
  readonly approver?: string | null;
  readonly approved_at?: string | null;
};

async function certFetch(url: string, init: RequestInit): Promise<Response> {
  if (process.env.USESTEADY_CERT_INSECURE_TLS === "1") {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      return await fetch(url, init);
    } finally {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }
  return fetch(url, init);
}

async function fetchProvenance(
  supabaseUrl: string,
  supabaseKey: string,
  organizationId: string,
  runId: string,
): Promise<ApprovalRecord | null> {
  const base = supabaseUrl.replace(/\/$/, "");
  const url =
    `${base}/rest/v1/portal_workflow_runs` +
    `?organization_id=eq.${encodeURIComponent(organizationId)}` +
    `&run_id=eq.${encodeURIComponent(runId)}` +
    "&select=approval_record&limit=1";

  const res = await certFetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const raw = rows[0] as Record<string, unknown>;
  if (typeof raw.approval_record !== "object" || raw.approval_record === null) {
    return null;
  }
  return raw.approval_record as ApprovalRecord;
}

export async function capturePhase1Baseline(
  config: GateWorkerConfig,
  processInstanceKey: string,
  job: CamundaJob,
): Promise<string> {
  const capturedAt = new Date().toISOString();
  const history = await config.camunda.fetchProcessInstanceHistory(processInstanceKey, job);
  const activities = await config.camunda.fetchActivityInstances(processInstanceKey, job);

  const phase1 = captureCamundaPhase1Evidence(config.storeDir, {
    processInstanceKey,
    processDefinitionKey: PROCESS_DEFINITION_KEY,
    captured_at: capturedAt,
    history,
    activities,
    audit_note:
      "Captured at invoke-usesteady-gate job activation, before UseSteady CLI invoked.",
  });

  return sealCamundaAloneBaseline(config.storeDir, phase1);
}

export function runUseSteadyGate(config: GateWorkerConfig): GateRunResult {
  if (!isBaselineSealed(config.storeDir)) {
    throw new Error(
      "Phase 1 baseline not sealed — capture CAMUNDA_ALONE_BASELINE_V1 before UseSteady gate",
    );
  }

  const workflowName = `integration-v1-gate-${config.stamp}`;
  const workDir = mkdtempSync(join(tmpdir(), "usesteady-integ-v1-"));
  mkdirSync(workDir, { recursive: true });

  const specPath = join(workDir, "gate-workflow.json");
  writeFileSync(specPath, JSON.stringify(buildGateWorkflowSpec(workflowName), null, 2), "utf8");

  const runEnv = {
    ...process.env,
    USESTEADY_STORE_DIR: config.storeDir,
    USESTEADY_NO_TELEMETRY: "1",
    USESTEADY_PORTAL_RUNS_URL: config.portalRunsUrl,
    USESTEADY_PORTAL_APPROVALS_URL: config.portalApprovalsUrl,
    USESTEADY_PORTAL_TOKEN: config.portalToken,
  };

  const runResult = spawnSync(
    "npx",
    [
      "tsx",
      "src/shell/cli/use-steady.ts",
      "run",
      specPath,
      workDir,
      "--pending-approval-bridge",
      "--report-to-portal",
    ],
    {
      cwd: config.repoRoot,
      env: runEnv,
      encoding: "utf8",
      timeout: 600_000,
      shell: true,
      stdio: "inherit",
    },
  );

  if (runResult.status !== 0) {
    throw new Error(`UseSteady gate run failed with exit ${runResult.status ?? "null"}`);
  }

  const resolved = resolveLatestCompletedUcpRoot(config.storeDir, { workflowName });
  if (resolved === null) {
    throw new Error(`could not resolve ucp_root_id for ${workflowName}`);
  }

  return {
    workflowRunId: resolved.workflowRunId,
    ucpRootId: resolved.ucpRootId,
    approver: "",
    approvedAt: "",
    workflowName,
  };
}

export async function resolveGateProvenance(
  config: GateWorkerConfig,
  gateResult: GateRunResult,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<GateRunResult> {
  const approval = await fetchProvenance(
    supabaseUrl,
    supabaseKey,
    config.portalToken,
    gateResult.workflowRunId,
  );
  const approver = approval?.approver?.trim() ?? "";
  const approvedAt = approval?.approved_at?.trim() ?? "";
  if (!approver || !approvedAt) {
    throw new Error("Mode A approver/approved_at missing after gate run");
  }
  return { ...gateResult, approver, approvedAt };
}

export async function handleInvokeGateJob(
  config: GateWorkerConfig,
  job: CamundaJob,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<Record<string, unknown>> {
  const baselinePath = await capturePhase1Baseline(config, job.processInstanceKey, job);

  console.log(`[integration-v1] Phase 1 sealed: ${baselinePath}`);
  console.log("[integration-v1] Operator: approve gate in Portal before timeout");

  let gateResult = runUseSteadyGate(config);
  gateResult = await resolveGateProvenance(config, gateResult, supabaseUrl, supabaseKey);

  return {
    gate_status: "approved",
    usesteady_workflow_run_id: gateResult.workflowRunId,
    ucp_root_id: gateResult.ucpRootId,
    approver: gateResult.approver,
    approved_at: gateResult.approvedAt,
    camunda_baseline_path: baselinePath,
  };
}

export function handleEnterpriseActionJob(
  config: GateWorkerConfig,
  job: CamundaJob,
): Record<string, unknown> {
  const vars = job.variables;
  const runId = String(vars.usesteady_workflow_run_id ?? "");
  const ucpRootId = String(vars.ucp_root_id ?? "");
  const approver = String(vars.approver ?? "");
  const approvedAt = String(vars.approved_at ?? "");

  if (!runId || !ucpRootId || !approver || !approvedAt) {
    throw new Error("enterprise-action job missing gate completion variables");
  }

  const record = buildApprovedActionRecord({
    camundaProcessInstanceId: job.processInstanceKey,
    usesteadyWorkflowRunId: runId,
    ucpRootId,
    approver,
    approvedAt,
  });

  const path = writeApprovedActionRecord(config.storeDir, record);
  console.log(`[integration-v1] enterprise action written: ${path}`);

  return { enterprise_action_path: path };
}

export async function runGateWorkerUntilComplete(
  config: GateWorkerConfig,
  processInstanceKey: string,
  supabaseUrl: string,
  supabaseKey: string,
  maxWaitMs = 600_000,
): Promise<unknown> {
  const start = Date.now();
  let gateDone = false;
  let actionDone = false;
  while (Date.now() - start < maxWaitMs) {
    const gateJobs = await config.camunda.activateJobs(JOB_TYPE_INVOKE_GATE, 1);
    await releaseForeignJobs(config.camunda, gateJobs, processInstanceKey);
    for (const job of gateJobs) {
      if (job.processInstanceKey !== processInstanceKey) continue;
      const variables = await handleInvokeGateJob(config, job, supabaseUrl, supabaseKey);
      await config.camunda.completeJob(job.jobKey, variables);
      gateDone = true;
    }

    const actionJobs = await config.camunda.activateJobs(JOB_TYPE_ENTERPRISE_ACTION, 1);
    await releaseForeignJobs(config.camunda, actionJobs, processInstanceKey);
    for (const job of actionJobs) {
      if (job.processInstanceKey !== processInstanceKey) continue;
      const variables = handleEnterpriseActionJob(config, job);
      await config.camunda.completeJob(job.jobKey, variables);
      actionDone = true;
    }

    if (gateDone && actionDone) {
      return {
        processInstanceKey,
        state: "COMPLETED",
        capture_method: "worker_observed",
        note: "Both invoke-usesteady-gate and enterprise-action jobs completed for this instance.",
      };
    }

    await sleep(2_000);
  }

  throw new Error(`process ${processInstanceKey} did not complete within ${maxWaitMs}ms`);
}

/** @deprecated Use runGateWorkerUntilComplete */
export async function pollAndHandleJobs(
  config: GateWorkerConfig,
  supabaseUrl: string,
  supabaseKey: string,
  maxRounds = 120,
): Promise<void> {
  for (let round = 0; round < maxRounds; round += 1) {
    const gateJobs = await config.camunda.activateJobs(JOB_TYPE_INVOKE_GATE, 1);
    for (const job of gateJobs) {
      const variables = await handleInvokeGateJob(config, job, supabaseUrl, supabaseKey);
      await config.camunda.completeJob(job.jobKey, variables);
    }

    const actionJobs = await config.camunda.activateJobs(JOB_TYPE_ENTERPRISE_ACTION, 1);
    for (const job of actionJobs) {
      const variables = handleEnterpriseActionJob(config, job);
      await config.camunda.completeJob(job.jobKey, variables);
    }

    if (gateJobs.length === 0 && actionJobs.length === 0) {
      await sleep(2_000);
    }
  }

  throw new Error("job polling exhausted — process may not have completed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function releaseForeignJobs(
  camunda: CamundaRestClient,
  jobs: readonly CamundaJob[],
  processInstanceKey: string,
): Promise<void> {
  for (const job of jobs) {
    if (job.processInstanceKey === processInstanceKey) continue;
    await camunda.failJob(
      job.jobKey,
      `integration-v1 worker scoped to process ${processInstanceKey}`,
    );
  }
}

export async function waitForProcessCompletion(
  camunda: CamundaRestClient,
  processInstanceKey: string,
  maxWaitMs = 600_000,
): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const history = await camunda.fetchProcessInstanceHistory(processInstanceKey);
    if (
      typeof history === "object" &&
      history !== null &&
      (history as Record<string, unknown>).state === "COMPLETED"
    ) {
      return history;
    }
    await sleep(3_000);
  }
  throw new Error(`process ${processInstanceKey} did not complete within ${maxWaitMs}ms`);
}
