import { readFileSync } from "node:fs";

import {
  JOB_TYPE_ENTERPRISE_ACTION,
  JOB_TYPE_INVOKE_GATE,
  PROCESS_DEFINITION_KEY,
  WORKER_NAME,
} from "./constants.js";
import type { CamundaJob } from "./types.js";

export type CamundaRestClientConfig = {
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
};

type JobActivationResponse = {
  readonly jobs?: ReadonlyArray<{
    readonly jobKey: string | number;
    readonly type: string;
    readonly processInstanceKey: string | number;
    readonly processDefinitionKey?: string | number;
    readonly processDefinitionId?: string;
    readonly processDefinitionVersion?: number;
    readonly elementInstanceKey?: string | number;
    readonly elementId?: string;
    readonly variables?: Readonly<Record<string, unknown>>;
  }>;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export class CamundaRestClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: CamundaRestClientConfig) {
    this.#baseUrl = normalizeBaseUrl(config.baseUrl);
    this.#fetch = config.fetchFn ?? fetch;
  }

  async deployBpmn(bpmnPath: string, resourceName: string): Promise<unknown> {
    const content = readFileSync(bpmnPath);
    const blob = new Blob([content], { type: "application/xml" });
    const form = new FormData();
    form.append("resources", blob, resourceName);

    const res = await this.#fetch(`${this.#baseUrl}/deployments`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Camunda deploy failed HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }

  async createProcessInstance(
    variables: Readonly<Record<string, unknown>> = {},
  ): Promise<{ processInstanceKey: string }> {
    const res = await this.#fetch(`${this.#baseUrl}/process-instances`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        processDefinitionId: PROCESS_DEFINITION_KEY,
        variables,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Camunda create instance failed HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { processInstanceKey?: string | number };
    const key = body.processInstanceKey;
    if (key === undefined || key === null) {
      throw new Error("Camunda create instance: missing processInstanceKey");
    }
    return { processInstanceKey: String(key) };
  }

  async activateJobs(jobType: string, maxJobs = 1): Promise<readonly CamundaJob[]> {
    const res = await this.#fetch(`${this.#baseUrl}/jobs/activation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        type: jobType,
        worker: WORKER_NAME,
        timeout: 600_000,
        maxJobsToActivate: maxJobs,
        requestTimeout: 15_000,
        fetchVariableNames: ["*"],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Camunda job activation failed HTTP ${res.status}: ${text}`);
    }
    const body = (await res.json()) as JobActivationResponse;
    const jobs = body.jobs ?? [];
    return jobs.map((job) => ({
      jobKey: String(job.jobKey),
      type: job.type,
      processInstanceKey: String(job.processInstanceKey),
      ...(job.processDefinitionKey !== undefined ? { processDefinitionKey: String(job.processDefinitionKey) } : {}),
      ...(job.processDefinitionId !== undefined ? { processDefinitionId: job.processDefinitionId } : {}),
      ...(job.processDefinitionVersion !== undefined ? { processDefinitionVersion: job.processDefinitionVersion } : {}),
      ...(job.elementInstanceKey !== undefined ? { elementInstanceKey: String(job.elementInstanceKey) } : {}),
      elementId: job.elementId ?? "",
      variables: job.variables ?? {},
    }));
  }

  async completeJob(
    jobKey: string,
    variables: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const res = await this.#fetch(`${this.#baseUrl}/jobs/${jobKey}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ variables }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Camunda job complete failed HTTP ${res.status}: ${text}`);
    }
  }

  async failJob(jobKey: string, errorMessage: string): Promise<void> {
    const res = await this.#fetch(`${this.#baseUrl}/jobs/${jobKey}/failure`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        retries: 0,
        errorMessage,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Camunda job fail failed HTTP ${res.status}: ${text}`);
    }
  }

  async fetchProcessInstanceHistory(
    processInstanceKey: string,
    jobHint?: CamundaJob,
  ): Promise<unknown> {
    const res = await this.#fetch(`${this.#baseUrl}/process-instances/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        filter: { processInstanceKey },
      }),
    });
    if (res.ok) {
      return res.json();
    }
    if (res.status !== 404) {
      const text = await res.text();
      throw new Error(`Camunda instance search failed HTTP ${res.status}: ${text}`);
    }

    return {
      processInstanceKey,
      state: "ACTIVE",
      capture_method: "job_activation_boundary",
      note:
        "Process instance search API is not enabled on this Camunda cluster; " +
        "EV-C1 snapshot taken at invoke-usesteady-gate job activation.",
      active_element: jobHint?.elementId ?? null,
      process_definition_id: jobHint?.processDefinitionId ?? null,
    };
  }

  async fetchActivityInstances(
    processInstanceKey: string,
    jobHint?: CamundaJob,
  ): Promise<unknown> {
    const res = await this.#fetch(`${this.#baseUrl}/element-instances/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        filter: { processInstanceKey },
      }),
    });
    if (res.ok) {
      return res.json();
    }
    if (res.status !== 404) {
      const text = await res.text();
      throw new Error(`Camunda activities search failed HTTP ${res.status}: ${text}`);
    }

    if (!jobHint) {
      return {
        processInstanceKey,
        capture_method: "unavailable",
        items: [],
      };
    }

    return {
      processInstanceKey,
      capture_method: "job_activation_boundary",
      items: [
        {
          elementId: jobHint.elementId,
          elementInstanceKey: jobHint.elementInstanceKey ?? null,
          jobType: jobHint.type,
        },
      ],
    };
  }
}

export const GATE_AND_ACTION_JOB_TYPES = [
  JOB_TYPE_INVOKE_GATE,
  JOB_TYPE_ENTERPRISE_ACTION,
] as const;
