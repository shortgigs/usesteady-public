import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { APPROVED_ACTION_SCHEMA, PROCESS_DEFINITION_KEY } from "./constants.js";
import type { ApprovedActionRecord } from "./types.js";

export function buildApprovedActionRecord(input: {
  camundaProcessInstanceId: string;
  usesteadyWorkflowRunId: string;
  ucpRootId: string;
  approver: string;
  approvedAt: string;
  executedAt?: string;
}): ApprovedActionRecord {
  return {
    schema: APPROVED_ACTION_SCHEMA,
    camunda_process_instance_id: input.camundaProcessInstanceId,
    camunda_process_definition_key: PROCESS_DEFINITION_KEY,
    usesteady_workflow_run_id: input.usesteadyWorkflowRunId,
    ucp_root_id: input.ucpRootId,
    approver: input.approver,
    approved_at: input.approvedAt,
    enterprise_action_executed_at: input.executedAt ?? new Date().toISOString(),
  };
}

export function writeApprovedActionRecord(
  storeDir: string,
  record: ApprovedActionRecord,
): string {
  const targetPath = join(storeDir, "integration-v1", "approved-action.json");
  mkdirSync(join(storeDir, "integration-v1"), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return targetPath;
}

export function parseApprovedActionRecord(raw: unknown): ApprovedActionRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const required = [
    "schema",
    "camunda_process_instance_id",
    "camunda_process_definition_key",
    "usesteady_workflow_run_id",
    "ucp_root_id",
    "approver",
    "approved_at",
    "enterprise_action_executed_at",
  ] as const;
  for (const key of required) {
    if (typeof o[key] !== "string" || (o[key] as string).trim().length === 0) {
      return null;
    }
  }
  if (o.schema !== APPROVED_ACTION_SCHEMA) return null;
  return o as unknown as ApprovedActionRecord;
}
