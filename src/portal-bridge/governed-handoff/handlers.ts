/**
 * W-E1 — Portal governed handoff handlers (Fix A two-phase).
 * W-W1/W-W2/W-W3/W-E2 — workspace registry, Fix B derivation, rehearsal, SCM.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import {
  handleGovernedApi,
  type GovernedApiDeps,
} from "../../governed-decision/http.js";
import { createGovernedDecisionStore } from "../../governed-decision/store.js";
import { produceDraft, ratifiableFingerprint } from "../../governed-decision/runner.js";
import {
  isRehearsalEnabled,
  rehearsalOpsFromRecord,
  senseSandboxRehearsal,
  type SandboxRehearsalEvidence,
} from "../../governed-decision/stages/sandbox-rehearsal-sensor.js";
import {
  extractExecutionPlanDraft,
  isHandoffNotExecutable,
  type PortalExecutionPlanDraft,
} from "./extract-plan.js";
import {
  deriveCandidatePlanFromPortalSteps,
  readPortalStepAnchors,
} from "./derive-from-portal-steps.js";
import {
  isRoutableAdoptedTask,
  MAX_ADOPTED_V2_HANDOFF_STEPS,
  readAdoptedCandidatePlanV2,
  summaryOnlyPlanFromAdoptedV2,
} from "./adopted-candidate-plan-v2.js";
import { resolveRoutedExecutorKind } from "./route-executor-class.js";
import { resolveHandoffDepsForKey } from "./resolve-handoff-deps.js";
import { readPortalSuppliedUcpRootId } from "../decision-record/resolve-ucp-root.js";
import {
  portalHandoffAuthFailure,
  portalHandoffUnavailable,
  readPortalBearerToken,
  validatePortalBearerToken,
} from "./auth.js";
import {
  reportRunToPortal,
  decisionSummaryFromExplicitRatification,
  deliveryReportSummaryFromOutcomes,
  unavailableDecisionSummary,
} from "../execution-return/report-run.js";
import {
  appendPortalAuthorityEvidence,
  loadPortalAuthorityTrust,
  verifyAuthorityAssertion,
  type AuthorityAssertionV1,
} from "../authority-assertion/index.js";
import { resolveStoredRecordUcpRootId } from "../decision-record/index.js";
import { getChain } from "../../ucp/persistence/query.js";
import { computeChainVerification } from "../../ucp/chain-verification.js";
import { makeHumanAttestationExecutor } from "../../governed-decision/stages/human-attestation-executor.js";
import { makeDocumentRecordExecutor } from "../../governed-decision/stages/document-record-executor.js";
import { makeDocumentRecordRealityProbe } from "../../governed-decision/stages/document-record-reality-probe.js";
import {
  approvedPlanFromDraft,
  capsuleLedgerPathForSandbox,
  materializeSandboxFs,
  probeProjection,
  sealCapsule,
  CapsuleLedger,
  contentAddress,
  type Capsule,
  type GpcWireStatus,
  type VerifiedProjectionRecord,
} from "../../governed-decision/gpc/index.js";
import { makeGovernedGpcSandboxProjectionObserver } from "../../execution/boundary-observer.js";
import type { WorkspaceRegistryEntry } from "../../governed-decision/workspace-registry.js";
import type { GovernedDecisionRecord } from "../../governed-decision/types.js";
import { buildAndPersistHandoffReplay } from "./handoff-replay.js";
import type { ExecutionReturnReplayRef } from "../execution-return/types.js";

/** Match createGovernedDecisionStore default — UCP getChain requires a real path. */
function resolveGovernedStoreDir(storeDir: string | undefined): string {
  const trimmed = typeof storeDir === "string" ? storeDir.trim() : "";
  if (trimmed.length > 0) return trimmed;
  // Prefer USESTEADY_STORE_DIR so handoff replay + CLI reconstruct share one durable root.
  const fromEnv = (process.env["USESTEADY_STORE_DIR"] ?? "").trim();
  if (fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".usesteady", "governed-decisions");
}

let wiredDeps: GovernedApiDeps | null = null;

/** Called from server.ts after GOVERNED_PORTAL deps are built. */
export function setPortalGovernedHandoffDeps(deps: GovernedApiDeps | null): void {
  wiredDeps = deps;
}

export function getPortalGovernedHandoffDeps(): GovernedApiDeps | null {
  return wiredDeps;
}

export type PortalHandoffDraftBody = {
  readonly goal?: unknown;
  readonly ucp_root_id?: unknown;
  readonly workflow_id?: unknown;
  readonly workspace_key?: unknown;
  readonly portal_steps?: unknown;
  /** W-E3 / B.S1 — adopted Candidate Plan V2 wire (executorClass preserved). */
  readonly adopted_candidate_plan?: unknown;
};

export type PortalHandoffRatifyBody = {
  readonly threadId?: unknown;
  readonly approver?: unknown;
  readonly approved_plan_hash?: unknown;
  readonly decision?: unknown;
  readonly workspace_key?: unknown;
  /** P1 authority carry: signed usesteady.authority_assertion.v1 envelope. */
  readonly authority_assertion?: unknown;
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireDeps(): GovernedApiDeps | { error: ReturnType<typeof portalHandoffUnavailable> } {
  if (wiredDeps === null) {
    return {
      error: portalHandoffUnavailable(
        "Governed handoff is not configured on this Core instance (GOVERNED_PORTAL=1 required).",
      ),
    };
  }
  return wiredDeps;
}

async function createDraftRecord(
  deps: GovernedApiDeps,
  body: PortalHandoffDraftBody,
): Promise<{ status: number; json: unknown }> {
  const goal = readNonEmptyString(body.goal);
  if (goal === null) {
    return { status: 400, json: { error: "goal required", message: "goal must be a non-empty string." } };
  }

  const workspaceKey = readNonEmptyString(body.workspace_key);
  const resolved = await resolveHandoffDepsForKey(deps, workspaceKey, { actuate: false });
  if (!resolved.ok) {
    return {
      status: resolved.status,
      json: { ok: false, code: resolved.code, message: resolved.message },
    };
  }
  const draftDeps = resolved.deps;

  // W-E3 / B.S1: adopted V2 branch BEFORE Fix B. Never call
  // deriveCandidatePlanFromPortalSteps / normalizeIntent on V2 tasks.
  const adoptedV2 = readAdoptedCandidatePlanV2(body);
  const adoptedSummaryPlan =
    adoptedV2 !== null ? summaryOnlyPlanFromAdoptedV2(adoptedV2) : null;

  const portalSteps = adoptedSummaryPlan !== null ? null : readPortalStepAnchors(body);
  let candidatePlan = adoptedSummaryPlan;
  if (candidatePlan === null && portalSteps !== null) {
    const derived = deriveCandidatePlanFromPortalSteps(portalSteps);
    if (!derived.ok) {
      if (derived.code === "content_pin_failed") {
        return {
          status: 422,
          json: {
            ok: false,
            code: "content_pin_failed",
            message:
              "This plan claims file content that UseSteady could not pin onto an executable create. Rephrase the step outcome to name the exact body (for example: exact content: my-body), then approve again.",
          },
        };
      }
      return {
        status: 422,
        json: {
          ok: false,
          code: "handoff_not_executable",
          message:
            "Approved portal steps could not be deterministically derived into executable operations (Fix B).",
        },
      };
    }
    candidatePlan = derived.plan;
  }
  const portalUcpRootId = readPortalSuppliedUcpRootId(body.ucp_root_id);
  const appendOpts =
    portalUcpRootId !== null ? { portalUcpRootId } : undefined;
  const handoffDraftDeps: GovernedApiDeps =
    portalUcpRootId !== null ? { ...draftDeps, portalUcpRootId } : draftDeps;

  if (adoptedV2 !== null && adoptedSummaryPlan === null) {
    const routableCount = adoptedV2.tasks.filter(isRoutableAdoptedTask).length;
    const overCap = routableCount > MAX_ADOPTED_V2_HANDOFF_STEPS;
    return {
      status: 422,
      json: {
        ok: false,
        code: "handoff_not_executable",
        message: overCap
          ? `Adopted Candidate Plan V2 has ${routableCount} routable tasks; handoff accepts at most ${MAX_ADOPTED_V2_HANDOFF_STEPS}.`
          : adoptedV2.tasks.length > 0 &&
              adoptedV2.tasks.every((t) => t.executorClass === "external")
            ? "Adopted Candidate Plan V2 is external-only (third-party systems). UseSteady cannot actuate those tasks; propose human|document|repo_change companions or a new Core-executable plan."
            : "Adopted Candidate Plan V2 has no routable executorClass task (human|document|repo_change with path).",
      },
    };
  }

  let draftRes: { status: number; json: unknown };
  let derivation: "adopted_candidate_plan_v2" | "portal_steps_fix_b" | undefined =
    adoptedSummaryPlan !== null
      ? "adopted_candidate_plan_v2"
      : portalSteps !== null
        ? "portal_steps_fix_b"
        : undefined;

  if (candidatePlan !== null) {
    const store = createGovernedDecisionStore(draftDeps.storeDir);
    const draft = await produceDraft(
      { goal, constraints: [] },
      {},
      {
        basisWorkspace: draftDeps.basisWorkspace ?? null,
        basisPolicy: draftDeps.basisPolicy ?? null,
        candidatePlan,
      },
    );
    const stored = store.appendDraft(draft, appendOpts);
    draftRes = {
      status: 201,
      json: {
        envelope: { threadId: stored.envelope.threadId, kind: stored.envelope.kind },
        projection: { recordId: stored.record.recordId },
      },
    };
  } else {
    draftRes = await handleGovernedApi(
      { method: "POST", path: "/decisions", body: { goal } },
      handoffDraftDeps,
    );
  }

  if (draftRes.status !== 201) {
    return draftRes;
  }

  const payload = draftRes.json as {
    envelope?: { threadId?: string };
    projection?: { recordId?: string };
  };
  const threadId = payload.envelope?.threadId;
  const recordId = payload.projection?.recordId;
  if (typeof threadId !== "string" || typeof recordId !== "string") {
    return {
      status: 500,
      json: { error: "draft_shape", message: "Draft response missing thread or record id." },
    };
  }

  const store = createGovernedDecisionStore(draftDeps.storeDir);
  const stored = store.getRecord(recordId);
  if (stored === null) {
    return {
      status: 500,
      json: { error: "draft_missing", message: "Draft record not found after create." },
    };
  }

  if (isHandoffNotExecutable(stored.record)) {
    const unavailableReason =
      stored.record.understanding.status === "unavailable"
        ? stored.record.understanding.reason
        : "";
    const contentPinFailed =
      unavailableReason.includes("content_pin_failed") ||
      unavailableReason.includes("content claim") ||
      unavailableReason.includes("pinned onto create_file");
    return {
      status: 422,
      json: {
        ok: false,
        code: contentPinFailed ? "content_pin_failed" : "handoff_not_executable",
        message: contentPinFailed
          ? "This plan claims file content that UseSteady could not pin onto an executable create. Rephrase the step outcome to name the exact body (for example: exact content: my-body), then approve again."
          : "UseSteady could not derive an executable plan for this work item. Planning-only workflows cannot be handed off yet.",
        threadId,
        recordId,
      },
    };
  }

  const plan = extractExecutionPlanDraft(stored.record, threadId);
  if (plan === null) {
    return {
      status: 422,
      json: {
        ok: false,
        code: "handoff_not_executable",
        message: "Draft has no ratifiable fingerprint — cannot proceed to execution.",
        threadId,
        recordId,
      },
    };
  }

  let rehearsal: SandboxRehearsalEvidence | undefined;
  if (isRehearsalEnabled()) {
    const sandboxRoot = draftDeps.basisWorkspace ?? null;
    if (sandboxRoot) {
      const ops = rehearsalOpsFromRecord(stored.record);
      rehearsal = senseSandboxRehearsal({ sandboxRoot, ops });
    } else {
      rehearsal = { status: "unavailable", reason: "No sandbox root configured for rehearsal." };
    }
  }

  const workflowId = readNonEmptyString(body.workflow_id);

  return {
    status: 200,
    json: {
      ok: true,
      draft: appendRehearsalToDraft(plan, rehearsal),
      metadata: {
        ...(portalUcpRootId !== null ? { ucp_root_id: portalUcpRootId } : {}),
        ...(workflowId !== null ? { workflow_id: workflowId } : {}),
        ...(workspaceKey !== null ? { workspace_key: workspaceKey } : {}),
        ...(derivation !== undefined ? { derivation } : {}),
        ...(adoptedV2 !== null
          ? {
              adopted_executor_classes: adoptedV2.tasks.map((t) => t.executorClass),
            }
          : {}),
      },
      ...(rehearsal !== undefined ? { rehearsal } : {}),
    },
  };
}

function appendRehearsalToDraft(
  plan: PortalExecutionPlanDraft,
  rehearsal: SandboxRehearsalEvidence | undefined,
): PortalExecutionPlanDraft & { readonly rehearsal?: SandboxRehearsalEvidence } {
  if (rehearsal === undefined) return plan;
  return { ...plan, rehearsal };
}

export async function handlePortalGovernedHandoffDraft(
  authorizationHeader: string | undefined,
  body: PortalHandoffDraftBody,
): Promise<{ status: number; json: unknown }> {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  const depsResult = requireDeps();
  if ("error" in depsResult) {
    return { status: depsResult.error.status, json: depsResult.error.body };
  }

  return createDraftRecord(depsResult, body);
}

export async function handlePortalGovernedHandoffRatify(
  authorizationHeader: string | undefined,
  body: PortalHandoffRatifyBody,
): Promise<{ status: number; json: unknown }> {
  const token = readPortalBearerToken(authorizationHeader);
  if (!validatePortalBearerToken(token)) {
    const fail = portalHandoffAuthFailure();
    return { status: fail.status, json: fail.body };
  }

  const threadId = readNonEmptyString(body.threadId);
  const approver = readNonEmptyString(body.approver);
  const approvedPlanHash = readNonEmptyString(body.approved_plan_hash);
  const decision = body.decision === "rejected" ? "rejected" : "approved";
  // Feature 2.2 summary evidence only. Operational `decision` above is unchanged
  // (absent/invalid still default to approved). Defaulted approval is not
  // explicit_human_decision evidence.
  const explicitHumanDecision =
    body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
  const workspaceKey = readNonEmptyString(body.workspace_key);

  if (threadId === null) {
    return { status: 400, json: { error: "threadId required" } };
  }
  if (approver === null) {
    return { status: 400, json: { error: "approver required", message: "Human seat (clerk_user_id) required." } };
  }
  if (approvedPlanHash === null) {
    return {
      status: 400,
      json: {
        error: "approved_plan_hash required",
        message: "Anchor hash from the reviewed draft is required.",
      },
    };
  }

  // P1 AUTHORITY CARRY (fail-closed): when Core has a pinned Portal authority
  // key configured, the ratify MUST carry a valid signed authority assertion
  // bound to THIS org (the bearer token), THIS thread, THIS plan hash, THIS
  // decision, and the body-supplied approver. The assertion's embedded public
  // key is diagnostic only — verification runs against the pinned key, never
  // the payload-supplied one. When pinning is not configured, behavior is
  // legacy: the approver is self-asserted transport metadata, honestly labeled.
  const authorityTrust = loadPortalAuthorityTrust(process.env);
  type RatifyAuthority =
    | { readonly status: "portal_signed_verified"; readonly assertion: AuthorityAssertionV1 }
    | { readonly status: "self_asserted"; readonly reason: string };
  let ratifyAuthority: RatifyAuthority = {
    status: "self_asserted",
    reason: "pinning_not_configured",
  };
  if (authorityTrust.status === "misconfigured") {
    return {
      status: 401,
      json: {
        error: "authority_trust_misconfigured",
        message: authorityTrust.reason,
      },
    };
  }
  if (authorityTrust.status === "configured") {
    if (body.authority_assertion === undefined || body.authority_assertion === null) {
      return {
        status: 401,
        json: {
          error: "authority_assertion_invalid",
          message: "Pinned Portal authority verification is configured; a signed authority assertion is required.",
          reason: "missing_assertion",
        },
      };
    }
    const verification = verifyAuthorityAssertion(
      body.authority_assertion,
      authorityTrust.trust,
      {
        organization_id: token as string,
        run_id: null,
        thread_id: threadId,
        step_index: null,
        decision: decision === "approved" ? "approve" : "reject",
        decision_basis: approvedPlanHash,
        authority_subject_id: approver,
      },
    );
    if (!verification.ok) {
      return {
        status: 401,
        json: {
          error: "authority_assertion_invalid",
          message: "The Portal authority assertion failed verification.",
          reason: verification.reason,
        },
      };
    }
    ratifyAuthority = { status: "portal_signed_verified", assertion: verification.assertion };
  }

  const depsResult = requireDeps();
  if ("error" in depsResult) {
    return { status: depsResult.error.status, json: depsResult.error.body };
  }
  const baseDeps = depsResult;

  const resolved = await resolveHandoffDepsForKey(baseDeps, workspaceKey, { actuate: true });
  if (!resolved.ok) {
    return {
      status: resolved.status,
      json: { ok: false, code: resolved.code, message: resolved.message },
    };
  }

  const store = createGovernedDecisionStore(resolved.deps.storeDir);
  const all = store.readAll();
  const draftStored = all.find(
    (s) => s.envelope.threadId === threadId && s.envelope.kind === "draft",
  );
  if (draftStored === undefined) {
    return {
      status: 404,
      json: { error: "draft_not_found", message: `No draft for thread ${threadId}.` },
    };
  }

  const currentHash = ratifiableFingerprint(draftStored.record);
  if (currentHash === null || currentHash !== approvedPlanHash) {
    return {
      status: 409,
      json: {
        error: "stale_draft",
        message: "The execution plan changed since you reviewed it. Refresh and confirm again.",
        code: "approved_plan_hash_mismatch",
      },
    };
  }

  // W-E4 / B.S2: Router selects delivery kind from adopted V2 executorClass
  // tags on the reviewed draft. Path A (no tags) keeps workspace kind.
  const workspaceKind = resolved.deps.deliveryExecutorKind ?? null;
  const routedKind = resolveRoutedExecutorKind({
    draftRecord: draftStored.record,
    workspaceKind,
  });

  let deps: GovernedApiDeps = {
    ...resolved.deps,
    approver,
  };
  if (routedKind === "human-attestation") {
    // W-E5 / B.S3: wire attestation executor; strip FS/SCM actuators.
    deps = {
      ...(deps.storeDir !== undefined ? { storeDir: deps.storeDir } : {}),
      ...(deps.approver !== undefined ? { approver: deps.approver } : {}),
      ...(deps.basisWorkspace !== undefined
        ? { basisWorkspace: deps.basisWorkspace }
        : {}),
      ...(deps.basisPolicy !== undefined ? { basisPolicy: deps.basisPolicy } : {}),
      ...(deps.reporter !== undefined ? { reporter: deps.reporter } : {}),
      ...(deps.draftReporter !== undefined
        ? { draftReporter: deps.draftReporter }
        : {}),
      ...(deps.deliveryReporter !== undefined
        ? { deliveryReporter: deps.deliveryReporter }
        : {}),
      ...(deps.portalUcpRootId !== undefined
        ? { portalUcpRootId: deps.portalUcpRootId }
        : {}),
      deliveryExecutorKind: routedKind,
      executor: makeHumanAttestationExecutor({
        attestorId: approver,
        attestedAt: new Date().toISOString(),
      }),
    };
  } else if (routedKind === "document-record") {
    // W-E6 / B.S4: wire document-record executor + independent probe.
    deps = {
      ...(deps.storeDir !== undefined ? { storeDir: deps.storeDir } : {}),
      ...(deps.approver !== undefined ? { approver: deps.approver } : {}),
      ...(deps.basisWorkspace !== undefined
        ? { basisWorkspace: deps.basisWorkspace }
        : {}),
      ...(deps.basisPolicy !== undefined ? { basisPolicy: deps.basisPolicy } : {}),
      ...(deps.reporter !== undefined ? { reporter: deps.reporter } : {}),
      ...(deps.draftReporter !== undefined
        ? { draftReporter: deps.draftReporter }
        : {}),
      ...(deps.deliveryReporter !== undefined
        ? { deliveryReporter: deps.deliveryReporter }
        : {}),
      ...(deps.portalUcpRootId !== undefined
        ? { portalUcpRootId: deps.portalUcpRootId }
        : {}),
      deliveryExecutorKind: routedKind,
      executor: makeDocumentRecordExecutor({
        recorderId: approver,
        recordedAt: new Date().toISOString(),
      }),
      realityProbe: makeDocumentRecordRealityProbe(),
    };
  } else if (routedKind !== null) {
    deps = { ...deps, deliveryExecutorKind: routedKind };
  }

  // GPC S4 — seal + project before execute when H approved and FS sealable.
  // Bind ≠ approve: approval_seal is the verified approved_plan_hash only.
  let sealedCapsule: Capsule | null = null;
  let gpcProjectionKey: string | null = null;
  let gpcClaimedRootLabel: string | null = null;
  const sandboxEntry: WorkspaceRegistryEntry | null = resolved.entry;
  const sandboxRoot = sandboxEntry?.sandboxRoot?.trim() ?? "";
  const fsActuation =
    decision === "approved" &&
    workspaceKey !== null &&
    sandboxRoot.length > 0 &&
    (routedKind === null || routedKind === "fs") &&
    (deps.deliveryExecutorKind === "fs" ||
      (deps.deliveryExecutorKind === undefined && !sandboxEntry?.scm));

  if (fsActuation) {
    const planStub = approvedPlanFromDraft({
      record: draftStored.record as GovernedDecisionRecord,
      planId: threadId,
      approvalSeal: approvedPlanHash,
    });
    if (planStub !== null) {
      try {
        sealedCapsule = sealCapsule(planStub);
        const ledger = new CapsuleLedger(capsuleLedgerPathForSandbox(sandboxRoot));
        ledger.appendCapsule(sealedCapsule);
        const projectionWorkspaceKey = workspaceKey as string;
        const projectionSink = baseDeps.boundarySink ?? deps.boundarySink;
        const project =
          projectionSink !== undefined
            ? makeGovernedGpcSandboxProjectionObserver(
                materializeSandboxFs,
                projectionSink,
              )
            : materializeSandboxFs;
        const projected = await Promise.resolve(
          project(sealedCapsule, sandboxRoot, projectionWorkspaceKey),
        );
        gpcProjectionKey = projected.receipt.projection_key;
        gpcClaimedRootLabel = projected.receipt.claimed_root_label;
      } catch (err) {
        return {
          status: 422,
          json: {
            ok: false,
            code: "gpc_seal_failed",
            message:
              err instanceof Error
                ? err.message
                : "Governed projection capsule seal failed.",
          },
        };
      }
    }
  }

  const ratifyRes = await handleGovernedApi(
    {
      method: "POST",
      path: `/decisions/${threadId}/ratify`,
      body: { decision },
    },
    deps,
  );

  if (ratifyRes.status !== 200) {
    return ratifyRes;
  }

  // P1 authority carry: preserve the consumed authority assertion DURABLY on
  // Core (sidecar JSONL in the governed store dir), bound to this thread and
  // plan hash. Never collapses verified values back into a bare approver
  // string — a later verifier can re-verify the preserved envelope offline.
  appendPortalAuthorityEvidence(resolveGovernedStoreDir(resolved.deps.storeDir), {
    recorded_at: new Date().toISOString(),
    path: "governed_handoff",
    verification:
      ratifyAuthority.status === "portal_signed_verified"
        ? "portal_signed_verified"
        : "self_asserted",
    ...(ratifyAuthority.status === "self_asserted"
      ? { reason: ratifyAuthority.reason }
      : {}),
    decision_id: threadId,
    organization_id: token,
    thread_id: threadId,
    decision: decision === "approved" ? "approve" : "reject",
    decided_at:
      ratifyAuthority.status === "portal_signed_verified"
        ? ratifyAuthority.assertion.payload.decided_at
        : null,
    authority_subject_id:
      ratifyAuthority.status === "portal_signed_verified"
        ? ratifyAuthority.assertion.payload.authority_subject_id
        : approver,
    key_id:
      ratifyAuthority.status === "portal_signed_verified"
        ? ratifyAuthority.assertion.payload.key_id
        : null,
    ...(body.authority_assertion !== undefined
      ? { assertion: body.authority_assertion }
      : {}),
  });

  // GPC — independent probe + verified projection record (Evidence Engine).
  let gpcWire: GpcWireStatus | null = null;
  if (
    sealedCapsule !== null &&
    gpcProjectionKey !== null &&
    workspaceKey !== null &&
    sandboxRoot.length > 0
  ) {
    try {
      const probe = probeProjection(
        sealedCapsule,
        sandboxRoot,
        gpcProjectionKey,
        { strictExtraFiles: false },
      );
      const status = probe.matches_capsule ? "verified" : "rejected";
      const recordPayload = {
        capsule_id: sealedCapsule.capsule_id,
        projection_key: gpcProjectionKey,
        target: "sandbox_fs" as const,
        observed_digests: probe.observed_digests,
        status,
      };
      const verified: VerifiedProjectionRecord = {
        record_id: contentAddress(recordPayload),
        capsule_id: sealedCapsule.capsule_id,
        projection_key: gpcProjectionKey,
        target: "sandbox_fs",
        verified_at: new Date().toISOString(),
        observed_digests: probe.observed_digests,
        status,
        note: probe.matches_capsule
          ? ""
          : `mismatch=${JSON.stringify(probe.mismatch_paths)}`,
        workspace_key: workspaceKey,
      };
      new CapsuleLedger(capsuleLedgerPathForSandbox(sandboxRoot)).appendVerified(
        verified,
      );
      gpcWire = {
        capsule_id: sealedCapsule.capsule_id,
        projection_key: gpcProjectionKey,
        claimed_root_label: gpcClaimedRootLabel ?? `sandbox_fs:${workspaceKey}`,
        verified_record_id: verified.record_id,
        status,
        backend: "sandbox_fs",
        workspace_key: workspaceKey,
      };
      process.stderr.write(
        `[gpc] capsule=${gpcWire.capsule_id.slice(0, 12)}... projection=${gpcWire.projection_key} status=${status}\n`,
      );
    } catch (err) {
      process.stderr.write(`[gpc] probe/append failed: ${String(err)}\n`);
    }
  }

  const plan = extractExecutionPlanDraft(draftStored.record, threadId);

  // --- W-E1 / N.S6: Automatic execution-return emitter ---
  // Side-channel only: must NEVER fail the ratify HTTP response. Production
  // GOVERNED_PORTAL deps often omit storeDir (store defaults to ~/.usesteady/…);
  // UCP getChain requires a concrete path — resolve the same default here.
  // Also surface a compact executionReturn on the HTTP response so Portal can
  // persist under the operator's entitlement org (Core's token may be a
  // different org_id).
  let executionReturn: {
    runId: string;
    ucpRootId: string;
    outcome: "success" | "failure" | "partial";
    executedAt: string;
    approvedAt: string | null;
    totalSteps: number;
    affectedResources: readonly { path: string; change_type: "create" | "update" | "delete" | "rename" }[];
    chainCount: number;
    /** P0-55 / INV-RRC-3 — kernel replay reference (success emits; fail-closed when unavailable). */
    replayRef: ExecutionReturnReplayRef | null;
    /** Honest omit reason when success lacked a reconstructable artifact. */
    replayOmitReason: string | null;
    decisionSummary: {
      total_steps: number;
      approved: number;
      rejected: number;
      executed: number;
      skipped: number;
      break_glass: boolean;
      approved_basis?: "explicit_human_decision" | "not_available";
      rejected_basis?: "explicit_human_decision" | "not_available";
      executed_basis?: "not_established";
      skipped_basis?: "explicit_human_decision" | "not_available";
    };
    deliveryReportSummary: {
      basis: "executor_delivery_report";
      total: number;
      accepted: number;
      rejected: number;
      skipped: number;
      pending: number;
      stopped: number;
      other: number;
    };
    exceptions: readonly { path: string; detail: string }[];
  } | null = null;
  /** SCM delivery evidence for Portal (PR URL / branch / commit) — top-level. */
  let scmEvidence: {
    prUrl: string | null;
    branch: string | null;
    commitSha: string | null;
  } = { prUrl: null, branch: null, commitSha: null };
  try {
    const storeDir = resolveGovernedStoreDir(resolved.deps.storeDir);
    const finalStored = store.readAll().find(
      (s) => s.envelope.threadId === threadId && s.envelope.kind === "final",
    );
    if (finalStored && plan !== null) {
      const record = finalStored.record as unknown as Record<string, unknown>;
      const execution = (record["execution"] ?? {}) as Record<string, unknown>;
      const execValue = (execution["value"] ?? {}) as Record<string, unknown>;
      const results = Array.isArray(execValue["results"])
        ? (execValue["results"] as unknown[])
        : [];
      scmEvidence = extractScmDeliveryEvidence(results);
      // Display projection never carries value.prUrl — prefer structured
      // evidence from stored execution results; fall back to projection only.
      if (!scmEvidence.prUrl) {
        const finalJson = ratifyRes.json as {
          projection?: {
            execution?: { value?: { prUrl?: string; pullRequestUrl?: string } };
          };
        };
        scmEvidence = {
          ...scmEvidence,
          prUrl:
            finalJson.projection?.execution?.value?.prUrl ??
            finalJson.projection?.execution?.value?.pullRequestUrl ??
            null,
        };
      }
      const failed = results.filter(
        (r) => (r as Record<string, unknown>)["status"] !== "ran",
      ).length;
      const ran = results.length;
      const outcome =
        ran === 0
          ? "success"
          : failed === 0
            ? "success"
            : failed === ran
              ? "failure"
              : "partial";

      const ratification = (record["ratification"] ?? {}) as Record<string, unknown>;
      const ratValue = (ratification["value"] ?? {}) as Record<string, unknown>;
      const approvedAt =
        typeof ratValue["at"] === "string" ? (ratValue["at"] as string) : null;
      const executedAt = approvedAt ?? finalStored.envelope.storedAt;

      const affectedResources = affectedResourcesFromExecutionResults(results);
      const exceptions = exceptionsFromExecutionResults(results);
      const outcomeLabels = results.map((r) =>
        (r as Record<string, unknown>)["status"] === "ran" ? "accepted" : "rejected",
      );

      const ucpRootId = resolveStoredRecordUcpRootId(finalStored, storeDir);
      if (ucpRootId !== null) {
        // INV-RRC-3: emit real replayRef + ensure durable UCP root in handoff store.
        // Understand may have written the Portal root under USESTEADY_STORE_DIR;
        // getChain here uses governed storeDir — copy/ensure before counting.
        const goalFallback =
          typeof finalStored.record.humanIntent?.goal === "string"
            ? finalStored.record.humanIntent.goal
            : plan.goal;
        const replay = buildAndPersistHandoffReplay({
          storeDir,
          ucpRootId,
          workflowName: plan.goal,
          results,
          outcome,
          goalFallback,
        });
        const chain = getChain(storeDir, ucpRootId);
        const chainCount = Math.max(replay.chainCount, chain.length);
        const chainVerification = computeChainVerification(chain.map((env) => env.id));
        // Feature 2.2: only an explicit body.decision of approved|rejected may
        // populate decision_summary counts. Operational default-to-approved is
        // not explicit_human_decision evidence. Delivery outcomes never
        // populate approved/executed. executed: 0 / not_established =
        // unknown-by-this-field, not non-execution, regardless of `ran`.
        const decisionSummary =
          explicitHumanDecision !== null
            ? decisionSummaryFromExplicitRatification(explicitHumanDecision, false)
            : unavailableDecisionSummary(1, false);
        const deliveryReportSummary = deliveryReportSummaryFromOutcomes(outcomeLabels);

        executionReturn = {
          runId: finalStored.record.recordId,
          ucpRootId,
          outcome,
          executedAt,
          approvedAt,
          totalSteps: decisionSummary.total_steps,
          affectedResources,
          chainCount,
          replayRef: replay.replayRef,
          replayOmitReason: replay.replayOmitReason,
          decisionSummary,
          deliveryReportSummary,
          exceptions,
        };

        void reportRunToPortal({
          flag: true, // Opt-in logic is handled inside reportRunToPortal via env vars
          buildInput: {
            runId: finalStored.record.recordId,
            ucpRootId,
            workflowName: plan.goal,
            outcome,
            executedAt,
            decisionSummary,
            deliveryReportSummary,
            approvalRecord: {
              mode: "per_step",
              approver,
              approved_at: approvedAt,
              // P1 authority carry: honest evidence-status label + preserved
              // assertion when verified.
              authority_status:
                ratifyAuthority.status === "portal_signed_verified"
                  ? "portal_signed_verified"
                  : "self_asserted",
              ...(ratifyAuthority.status === "portal_signed_verified"
                ? { authority_assertion: ratifyAuthority.assertion }
                : {}),
            },
            chainCount,
            ...(affectedResources.length > 0 ? { affectedResources } : {}),
            ...(chainVerification ? { chainVerification } : {}),
            ...(replay.replayRef ? { replayRef: replay.replayRef } : {}),
          },
        }).catch(() => {
          /* side-channel: execution-return failure must not block ratification response */
        });
      }
    }
  } catch {
    /* side-channel: chain/report must not turn a successful ratify into 500 */
  }
  // -------------------------------------------------------

  const executorKind = deps.deliveryExecutorKind ?? routedKind ?? null;

  // Prefer the FINAL record id (Evidence Engine / runs / decision-record join
  // key). Omitting it left Portal falling back to the draft id, which
  // mis-keys portal_router_deliveries vs portal_workflow_runs.
  const finalPayload = ratifyRes.json as {
    projection?: { recordId?: string };
  };
  const finalRecordId =
    typeof finalPayload.projection?.recordId === "string" &&
    finalPayload.projection.recordId.trim().length > 0
      ? finalPayload.projection.recordId.trim()
      : null;

  return {
    status: 200,
    json: {
      ok: true,
      ratified: true,
      threadId,
      approver,
      approverKind: "human",
      // P1 authority carry: the honest evidence-status label. The verified
      // assertion itself is preserved in the authority-evidence sidecar and
      // echoed here so the Portal can persist/re-verify it.
      authority:
        ratifyAuthority.status === "portal_signed_verified"
          ? {
              status: "portal_signed_verified",
              key_id: ratifyAuthority.assertion.payload.key_id,
              assertion: ratifyAuthority.assertion,
            }
          : { status: "self_asserted", reason: ratifyAuthority.reason },
      plan,
      ...(finalRecordId ? { recordId: finalRecordId } : {}),
      ...(scmEvidence.prUrl ? { prUrl: scmEvidence.prUrl } : {}),
      ...(scmEvidence.branch ? { branch: scmEvidence.branch } : {}),
      ...(scmEvidence.commitSha ? { commitSha: scmEvidence.commitSha } : {}),
      ...(executorKind ? { executorKind } : {}),
      ...(executionReturn ? { executionReturn } : {}),
      ...(gpcWire ? { gpc: gpcWire } : {}),
      final: ratifyRes.json,
    },
  };
}

/**
 * Parse SCM PR / branch / commit from execution result detail strings.
 * Detail shape (scm-executor): 
 *   committed to github PR #7 (https://.../pull/7) on usesteady/abc @ deadbeef
 */
export function extractScmDeliveryEvidence(
  results: readonly unknown[],
): { prUrl: string | null; branch: string | null; commitSha: string | null } {
  let prUrl: string | null = null;
  let branch: string | null = null;
  let commitSha: string | null = null;
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const detail =
      typeof (raw as { detail?: unknown }).detail === "string"
        ? (raw as { detail: string }).detail
        : "";
    if (detail.length === 0) continue;
    if (!prUrl) {
      const prMatch =
        detail.match(/\((https?:\/\/[^)\s]+\/pull\/\d+)\)/i) ??
        detail.match(/PR #\d+\s*\((https?:\/\/[^)\s]+)\)/i);
      if (prMatch?.[1]) prUrl = prMatch[1].trim();
    }
    if (!branch || !commitSha) {
      const branchMatch = detail.match(
        /\bon\s+(\S+)\s+@\s+([0-9a-f]{7,40})\b/i,
      );
      if (branchMatch?.[1] && branchMatch[2]) {
        branch = branchMatch[1];
        commitSha = branchMatch[2];
      }
    }
  }
  return { prUrl, branch, commitSha };
}

/** Paths + change-types from governed execution results (INV-ERB-P2). */
function affectedResourcesFromExecutionResults(
  results: readonly unknown[],
): { path: string; change_type: "create" | "update" | "delete" | "rename" }[] {
  const out: { path: string; change_type: "create" | "update" | "delete" | "rename" }[] = [];
  for (const raw of results) {
    const row = raw as { status?: unknown; op?: { kind?: unknown; path?: unknown; toPath?: unknown } };
    if (row.status !== "ran" || !row.op || typeof row.op.kind !== "string") continue;
    const path = typeof row.op.path === "string" ? row.op.path.trim() : "";
    if (!path) continue;
    switch (row.op.kind) {
      case "create_file":
      case "create_dir":
        out.push({ path, change_type: "create" });
        break;
      case "replace_in_file":
        out.push({ path, change_type: "update" });
        break;
      case "delete_file":
        out.push({ path, change_type: "delete" });
        break;
      case "rename_file": {
        const toPath = typeof row.op.toPath === "string" ? row.op.toPath.trim() : "";
        out.push({ path: toPath.length > 0 ? toPath : path, change_type: "rename" });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Honest per-op failures for Portal (create-only no-clobber, unsupported ops, …). */
export function exceptionsFromExecutionResults(
  results: readonly unknown[],
): { path: string; detail: string }[] {
  const out: { path: string; detail: string }[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as {
      status?: unknown;
      detail?: unknown;
      op?: { path?: unknown };
    };
    if (row.status === "ran") continue;
    const path =
      typeof row.op?.path === "string" ? row.op.path.trim() : "";
    const detail =
      typeof row.detail === "string" && row.detail.trim().length > 0
        ? row.detail.trim()
        : "not actuated";
    if (!path) continue;
    out.push({ path, detail });
  }
  return out;
}
