/** PROG-INTEGRATION-V1 Slice 1 — Camunda / gate wire types. */

export type CamundaJob = {
  readonly jobKey: string;
  readonly type: string;
  readonly processInstanceKey: string;
  readonly processDefinitionKey?: string;
  readonly processDefinitionId?: string;
  readonly processDefinitionVersion?: number;
  readonly elementInstanceKey?: string;
  readonly elementId: string;
  readonly variables: Readonly<Record<string, unknown>>;
};

export type GateCompletionVariables = {
  readonly gate_status: "approved";
  readonly usesteady_workflow_run_id: string;
  readonly ucp_root_id: string;
  readonly approver: string;
  readonly approved_at: string;
};

export type ApprovedActionRecord = {
  readonly schema: string;
  readonly camunda_process_instance_id: string;
  readonly camunda_process_definition_key: string;
  readonly usesteady_workflow_run_id: string;
  readonly ucp_root_id: string;
  readonly approver: string;
  readonly approved_at: string;
  readonly enterprise_action_executed_at: string;
};

export type CamundaHistoryCapture = {
  readonly processInstanceKey: string;
  readonly processDefinitionKey: string;
  readonly captured_at: string;
  readonly history: unknown;
  readonly activities: unknown;
  readonly audit_note: string;
};

export type Phase1BaselineInput = {
  readonly processInstanceKey: string;
  readonly processDefinitionKey: string;
  readonly capturedAt: string;
  readonly evidenceDir: string;
  readonly historyFile: string;
  readonly activitiesFile: string;
  readonly auditFile: string;
};

export type GateRunResult = {
  readonly workflowRunId: string;
  readonly ucpRootId: string;
  readonly approver: string;
  readonly approvedAt: string;
  readonly workflowName: string;
};
