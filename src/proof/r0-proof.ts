import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CursorInProcessAdapter } from "../cursor/adapters/inprocess-adapter.js";
import { approveArtifact, bindArtifactEffectiveReceiver } from "../cursor/artifact-mapper.js";
import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
import type { CursorDeliveryRequest, CursorHandoffArtifact } from "../cursor/types.js";
import { bindOnePath } from "../input/effective-resource.js";
import {
  captureProofActivation,
  newActivationSession,
  type ProofActivationEventName,
  type ProofActivationProperties,
} from "../friction/activation.js";
import { isInteractiveTTY } from "../governed-decision/output.js";
import { executeCursorEffect, type CursorEffectBoundaryOutcome } from "../workflow/cursor-effect-boundary.js";
import type { EffectDecision } from "../workflow/effect-decision.js";
import type { OutcomeVerification } from "../workflow/outcome-verification.js";
import {
  observePreparedSessionEffect,
  prepareCursorObservation,
  type PreparedSessionFileObservation,
} from "../workflow/session-outcome-observation.js";

export type ProofAuthority = {
  readonly kind: "human_tty_proof_approval";
  readonly scope: "disposable_local_proof_sandbox";
};

export type ProofStageRecord = {
  readonly proposal: string;
  readonly authority: ProofAuthority;
  readonly effectDecision: EffectDecision;
  readonly executorReport: string;
  readonly observation:
    | OutcomeVerification
    | {
        readonly executorReport: "refused";
        readonly status: "not_observed";
        readonly observation: "not_required";
        readonly observationDetail: string;
      };
};

export type R0ProofResult = {
  readonly schemaVersion: "usesteady.r0-proof.v1";
  readonly sandbox: string;
  readonly elapsedMs: number;
  readonly verified: ProofStageRecord;
  readonly refusal: ProofStageRecord;
  readonly unresolved: ProofStageRecord;
  readonly fixtureDisclosure: string;
};

export type R0ProofIO = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Test seam only. Production CLI leaves this unset and uses real TTY detection. */
  readonly interactive?: boolean;
};

export type R0ProofTelemetrySink = (
  event: ProofActivationEventName,
  sessionId: string,
  properties?: ProofActivationProperties,
) => void;

export type R0ProofOptions = {
  readonly approved: boolean;
  readonly keepSandbox?: boolean;
  readonly io: R0ProofIO;
  /** Test seam. Production uses the privacy-bounded activation transport. */
  readonly telemetry?: R0ProofTelemetrySink;
};

const FIXTURE_DISCLOSURE =
  "The unresolved case uses a bundled acceptance-only fixture transport. It is NOT a live Cursor provider/session; it exists only to prove that executor acceptance is not completion evidence.";

function isInteractive(io: R0ProofIO): boolean {
  return io.interactive ?? isInteractiveTTY();
}

function authority(): ProofAuthority {
  return {
    kind: "human_tty_proof_approval",
    scope: "disposable_local_proof_sandbox",
  };
}

function emit(
  sink: R0ProofTelemetrySink,
  event: ProofActivationEventName,
  sessionId: string,
  properties: ProofActivationProperties = {},
): void {
  try {
    sink(event, sessionId, properties);
  } catch {
    // Measurement is evidence-only and must never alter proof execution.
  }
}

function makeArtifact(
  id: string,
  filePath: string,
  oldValue: string,
  newValue: string,
  workspaceRoot: string,
): CursorHandoffArtifact {
  const pending: CursorHandoffArtifact = {
    id,
    intentId: `${id}-intent`,
    responseId: `${id}-response`,
    mode: "execute",
    changeSpec: {
      category: "r0_proof_replace",
      summary: `Replace ${JSON.stringify(oldValue)} with ${JSON.stringify(newValue)} in ${filePath}`,
      impact: [filePath],
      confidence: "high",
      basis: ["bundled R0 proof fixture"],
      parsedChange: { oldValue, newValue, filePath },
    },
    ocdClearance: {
      status: "cleared",
      rulesFired: [],
      conflictsDetected: [],
    },
    eligibility: "pending_confirmation",
    scopeConstraint: {
      allowedFiles: [filePath],
      allowedScopes: [],
      prohibitedPatterns: [],
    },
  };
  const bound = bindOnePath(workspaceRoot, filePath);
  if (!bound.ok) {
    throw new Error(`R0 proof could not bind ${filePath}: ${bound.message}`);
  }
  return approveArtifact(bindArtifactEffectiveReceiver(pending, bound.bind), Date.now());
}

function makeRequest(
  id: string,
  filePath: string,
  oldValue: string,
  newValue: string,
  workspaceRoot: string,
): CursorDeliveryRequest {
  return {
    deliveryId: `${id}-delivery`,
    sentAt: Date.now(),
    artifact: makeArtifact(id, filePath, oldValue, newValue, workspaceRoot),
  };
}

function decisionFrom(outcome: CursorEffectBoundaryOutcome): EffectDecision {
  if (outcome.kind !== "decision") {
    throw new Error(`R0 proof expected a semantic EffectDecision, received ${outcome.kind}.`);
  }
  return outcome.decision;
}

function reportFrom(outcome: CursorEffectBoundaryOutcome): string {
  if (outcome.kind === "decision") {
    const response = outcome.cursorResponse;
    if (response.kind === "accepted") return "accepted";
    return `${response.kind}:${response.errorCode}`;
  }
  if (outcome.kind === "scope") return "refused_due_to_scope";
  return "non_semantic_failure";
}

async function executeObserved(
  plugin: CursorEditorPlugin,
  request: CursorDeliveryRequest,
  workspaceRoot: string,
): Promise<{
  readonly outcome: CursorEffectBoundaryOutcome;
  readonly prepared: PreparedSessionFileObservation | null;
  readonly verification?: OutcomeVerification;
}> {
  const prepared = prepareCursorObservation(request, workspaceRoot);
  const outcome = await executeCursorEffect(plugin, request);
  if (
    outcome.kind === "decision" &&
    outcome.decision.kind === "accepted" &&
    prepared !== null
  ) {
    return {
      outcome,
      prepared,
      verification: observePreparedSessionEffect(prepared),
    };
  }
  return { outcome, prepared };
}

function renderRecord(io: R0ProofIO, title: string, record: ProofStageRecord): void {
  io.out(`\n${title}`);
  io.out(`  PROPOSAL         ${record.proposal}`);
  io.out(`  AUTHORITY        human TTY --approve; scope=${record.authority.scope}`);
  io.out(
    `  EFFECT DECISION  ${
      record.effectDecision.kind === "accepted"
        ? "accepted"
        : `refused:${record.effectDecision.code}`
    }`,
  );
  io.out(`  EXECUTOR REPORT  ${record.executorReport}`);
  if (record.observation.status === "not_observed") {
    io.out(`  OBSERVATION      not_required — ${record.observation.observationDetail}`);
  } else {
    const reality = record.observation.realityVerdict ?? "not_observed";
    io.out(`  OBSERVATION      ${record.observation.status}; reality=${reality}`);
    if (record.observation.observationDetail) {
      io.out(`                   ${record.observation.observationDetail}`);
    }
  }
}

/**
 * Run the bounded public R0 proof product.
 *
 * Authority is intentionally narrow: a real interactive operator must supply
 * `--approve`, and that approval authorizes ONLY the disposable proof sandbox.
 * This command does not authorize a customer workspace, Production, a provider
 * session, or any other runtime effect.
 */
export async function runR0Proof(options: R0ProofOptions): Promise<R0ProofResult | null> {
  const { io } = options;
  if (!options.approved) {
    io.err("R0 proof requires explicit approval. Run: usesteady proof --approve");
    return null;
  }
  if (!isInteractive(io)) {
    io.err("R0 proof human approval requires an interactive TTY; refusing non-interactive approval.");
    return null;
  }

  const telemetry = options.telemetry ?? captureProofActivation;
  const telemetrySession = newActivationSession();
  const started = Date.now();
  const sandbox = mkdtempSync(join(tmpdir(), "usesteady-r0-proof-"));
  const verifiedDir = join(sandbox, "verified");
  const refusalDir = join(sandbox, "refusal");
  const unresolvedDir = join(sandbox, "unresolved");
  mkdirSync(verifiedDir);
  mkdirSync(refusalDir);
  mkdirSync(unresolvedDir);

  emit(telemetry, "proof_started", telemetrySession);

  io.out("UseSteady R0 proof — bounded disposable local sandbox");
  io.out("Five stages stay separate: proposal -> authority -> EffectDecision -> executor report -> observation.");
  io.out("Approval applies only to this disposable proof sandbox.");

  try {
    const verifiedFile = "target.txt";
    writeFileSync(join(verifiedDir, verifiedFile), "old", "utf8");
    const verifiedRequest = makeRequest("r0-verified", verifiedFile, "old", "new", verifiedDir);
    const verifiedExec = await executeObserved(
      new CursorInProcessAdapter(verifiedDir),
      verifiedRequest,
      verifiedDir,
    );
    const verifiedDecision = decisionFrom(verifiedExec.outcome);
    if (verifiedDecision.kind !== "accepted" || verifiedExec.verification?.status !== "verified") {
      throw new Error("R0 verified path did not reach accepted + independently verified state.");
    }
    if (readFileSync(join(verifiedDir, verifiedFile), "utf8") !== "new") {
      throw new Error("R0 verified path post-state did not match expected content.");
    }
    const verified: ProofStageRecord = {
      proposal: 'replace "old" with "new" in verified/target.txt',
      authority: authority(),
      effectDecision: verifiedDecision,
      executorReport: reportFrom(verifiedExec.outcome),
      observation: verifiedExec.verification,
    };
    emit(telemetry, "proof_stage_completed", telemetrySession, {
      stage: "verified",
      decision: "accepted",
      observationStatus: "verified",
    });

    const refusalFile = "target.txt";
    writeFileSync(join(refusalDir, refusalFile), "old and old", "utf8");
    const refusalRequest = makeRequest("r0-refusal", refusalFile, "old", "new", refusalDir);
    const refusalExec = await executeObserved(
      new CursorInProcessAdapter(refusalDir),
      refusalRequest,
      refusalDir,
    );
    const refusalDecision = decisionFrom(refusalExec.outcome);
    if (refusalDecision.kind !== "refused") {
      throw new Error("R0 refusal path unexpectedly produced an accepted decision.");
    }
    if (readFileSync(join(refusalDir, refusalFile), "utf8") !== "old and old") {
      throw new Error("R0 refusal path mutated reality despite refusal.");
    }
    const refusal: ProofStageRecord = {
      proposal: 'replace ambiguous "old" with "new" in refusal/target.txt',
      authority: authority(),
      effectDecision: refusalDecision,
      executorReport: reportFrom(refusalExec.outcome),
      observation: {
        executorReport: "refused",
        status: "not_observed",
        observation: "not_required",
        observationDetail: "semantic refusal stopped the effect before accepted execution; target remained unchanged.",
      },
    };
    emit(telemetry, "proof_stage_completed", telemetrySession, {
      stage: "refusal",
      decision: "refused",
      refusalCode: refusalDecision.code,
      observationStatus: "not_observed",
    });

    const unresolvedFile = "target.txt";
    writeFileSync(join(unresolvedDir, unresolvedFile), "old", "utf8");
    const unresolvedRequest = makeRequest("r0-unresolved", unresolvedFile, "old", "new", unresolvedDir);
    const acceptanceOnlyFixture: CursorEditorPlugin = {
      async receive(request) {
        return {
          kind: "accepted",
          deliveryId: request.deliveryId,
          artifactId: request.artifact.id,
          receivedAt: Date.now(),
        };
      },
    };
    const unresolvedExec = await executeObserved(
      acceptanceOnlyFixture,
      unresolvedRequest,
      unresolvedDir,
    );
    const unresolvedDecision = decisionFrom(unresolvedExec.outcome);
    if (unresolvedDecision.kind !== "accepted") {
      throw new Error("R0 unresolved fixture did not produce an accepted executor report.");
    }
    if (unresolvedExec.verification?.status !== "unknown") {
      throw new Error("R0 unresolved fixture was incorrectly promoted beyond unknown.");
    }
    if (readFileSync(join(unresolvedDir, unresolvedFile), "utf8") !== "old") {
      throw new Error("R0 acceptance-only fixture unexpectedly changed reality.");
    }
    const unresolved: ProofStageRecord = {
      proposal: 'replace "old" with "new" in unresolved/target.txt',
      authority: authority(),
      effectDecision: unresolvedDecision,
      executorReport: `${reportFrom(unresolvedExec.outcome)} (bundled acceptance-only fixture)`,
      observation: unresolvedExec.verification,
    };
    emit(telemetry, "proof_stage_completed", telemetrySession, {
      stage: "unresolved",
      decision: "accepted",
      observationStatus: "unknown",
    });

    renderRecord(io, "1/3 ALLOWED + VERIFIED", verified);
    renderRecord(io, "2/3 GOVERNED REFUSAL", refusal);
    renderRecord(io, "3/3 ACCEPTED != VERIFIED", unresolved);
    io.out(`\nDISCLOSURE: ${FIXTURE_DISCLOSURE}`);

    const elapsedMs = Date.now() - started;
    emit(telemetry, "proof_completed", telemetrySession, { elapsedMs });
    io.out(`\nFIRST-PROOF ELAPSED: ${elapsedMs} ms (R0 target: <= 300000 ms)`);
    io.out(`SANDBOX: ${sandbox}${options.keepSandbox ? " (kept)" : " (removed after proof)"}`);

    return {
      schemaVersion: "usesteady.r0-proof.v1",
      sandbox,
      elapsedMs,
      verified,
      refusal,
      unresolved,
      fixtureDisclosure: FIXTURE_DISCLOSURE,
    };
  } catch (error) {
    const errorCategory =
      error instanceof Error && error.message.startsWith("R0 ")
        ? "proof_invariant"
        : "unexpected";
    emit(telemetry, "proof_failed", telemetrySession, { errorCategory });
    throw error;
  } finally {
    if (!options.keepSandbox) {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
}
