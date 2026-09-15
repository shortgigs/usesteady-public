import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BASELINE_ARTIFACT_ID } from "./constants.js";
import type { CamundaHistoryCapture, Phase1BaselineInput } from "./types.js";

export function integrationV1Root(storeDir: string): string {
  return join(storeDir, "integration-v1");
}

export function evidenceRoot(storeDir: string): string {
  return join(integrationV1Root(storeDir), "evidence");
}

export function reportsRoot(storeDir: string): string {
  return join(integrationV1Root(storeDir), "reports");
}

export function writeJsonEvidence(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function captureCamundaPhase1Evidence(
  storeDir: string,
  capture: CamundaHistoryCapture,
): Phase1BaselineInput {
  const evDir = evidenceRoot(storeDir);
  mkdirSync(evDir, { recursive: true });

  const instanceId = capture.processInstanceKey;
  const historyFile = join(evDir, `camunda-history-${instanceId}.json`);
  const activitiesFile = join(evDir, `camunda-activities-${instanceId}.json`);
  const auditFile = join(evDir, `camunda-audit-${instanceId}.json`);

  writeJsonEvidence(historyFile, {
    artifact: "EV-C1",
    ...capture,
  });

  writeJsonEvidence(activitiesFile, {
    artifact: "EV-C2",
    processInstanceKey: capture.processInstanceKey,
    processDefinitionKey: capture.processDefinitionKey,
    captured_at: capture.captured_at,
    activities: capture.activities,
  });

  writeJsonEvidence(auditFile, {
    artifact: "EV-C3",
    processInstanceKey: capture.processInstanceKey,
    captured_at: capture.captured_at,
    audit_note: capture.audit_note,
    camunda_approval_fields: null,
    note:
      "Camunda Alone arm — captured at gate boundary before UseSteady gate invoked. " +
      "Approval provenance expected partial/implementation-specific.",
  });

  return {
    processInstanceKey: instanceId,
    processDefinitionKey: capture.processDefinitionKey,
    capturedAt: capture.captured_at,
    evidenceDir: evDir,
    historyFile,
    activitiesFile,
    auditFile,
  };
}

export function buildCamundaAloneBaselineMarkdown(input: Phase1BaselineInput): string {
  return `# Camunda Alone Baseline v1

**Artifact ID:** \`${BASELINE_ARTIFACT_ID}\`  
**Status:** SEALED — Phase 1 complete; do not revise after UseSteady path runs  
**Program:** \`PROG-INTEGRATION-V1\`  
**Captured at:** ${input.capturedAt}

> **Phase 1 only.** This artifact is the legitimate baseline for Question 2.  
> Populate \`INTEGRATION_V1_GOVERNANCE_DELTA_V1.md\` Camunda Alone column from this file only.

---

## Process instance

| Field | Value |
|-------|-------|
| \`process_instance_key\` | ${input.processInstanceKey} |
| \`process_definition_key\` | ${input.processDefinitionKey} |

---

## Evidence pointers (Phase 1)

| ID | File |
|----|------|
| EV-C1 | \`${input.historyFile}\` |
| EV-C2 | \`${input.activitiesFile}\` |
| EV-C3 | \`${input.auditFile}\` |

---

## Camunda Alone — governance surface (honest summary)

| Capability | Camunda Alone (this baseline) |
|------------|------------------------------|
| Workflow history | Process instance + history export (EV-C1) |
| BPMN state | Activity instances at gate boundary (EV-C2) |
| Approval provenance | Not explicit at gate — audit partial (EV-C3) |
| Execution authority chain | **Not asserted** by Camunda history alone |
| Independent replay | Camunda history replay only — limited for governance |
| Independent verification | Requires Camunda tooling access |
| Exportable governance artifact | Camunda exports only — no UseSteady authority chain |

---

## Seal

Phase 1 sealed at ${input.capturedAt}. UseSteady gate must not run before this artifact exists.

Provenance:
 Agent: dev-agent-shortgigs
 Repo: shortgigs/usesteady-core
 Artifact: ${BASELINE_ARTIFACT_ID}
`;
}

export function sealCamundaAloneBaseline(
  storeDir: string,
  input: Phase1BaselineInput,
): string {
  const reportsDir = reportsRoot(storeDir);
  mkdirSync(reportsDir, { recursive: true });
  const baselinePath = join(reportsDir, "CAMUNDA_ALONE_BASELINE_V1.md");
  writeFileSync(baselinePath, buildCamundaAloneBaselineMarkdown(input), "utf8");
  return baselinePath;
}

export function isBaselineSealed(storeDir: string): boolean {
  const baselinePath = join(reportsRoot(storeDir), "CAMUNDA_ALONE_BASELINE_V1.md");
  if (!existsSync(baselinePath)) return false;
  const content = readFileSync(baselinePath, "utf8");
  return content.includes("**Status:** SEALED");
}

export function writePhase2Manifest(
  storeDir: string,
  manifest: Record<string, unknown>,
): string {
  const path = join(reportsRoot(storeDir), "phase2-manifest.json");
  mkdirSync(reportsRoot(storeDir), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path;
}
