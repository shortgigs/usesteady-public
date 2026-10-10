/**
 * Decision Basis stage adapter — spine port v1.
 *
 * Assembles the five gauge-tagged Decision Basis sub-sections for the governed-
 * decision spine. Each sub-section is wired honestly:
 *
 *   evidence       → derived from priorObservation when the loop is active;
 *                    connected via the workspace pre-state sensor (L3.S1) when
 *                    the understanding carries executable operations;
 *                    unavailable when there is nothing to sense.
 *   policy         → connected via the OCD policy sensor (L3.S2) when a surface
 *                    provides its OCD policy: the policy is read verbatim and the
 *                    proposed op targets are evaluated through the constraint
 *                    authority's own rule code (never reinterpreted). A
 *                    conflict_detected verdict is VISIBLE in the basis before
 *                    ratification — it informs H, it does not gate.
 *                    unavailable when no surface provided a policy source.
 *   constraints    → connected; reads real human-supplied constraints from ctx.
 *   sourceOfRecord → connected via captureRepositoryProvenance() (git sensor)
 *                    at the SAME workspace root evidence uses, OR via a surface-
 *                    prebuilt section (e.g. GitHub API HEAD for scm-github
 *                    handoffs that have no local checkout); unavailable when
 *                    neither sensor can establish a real repository state.
 *   runtimeState   → connected with deterministic process facts (version, platform).
 *
 * ── Gauge law ──────────────────────────────────────────────────────────────────
 *
 *   "connected"  → wired to a real runtime source, read deterministically.
 *   "derived"    → explicitly computed from a connected section (evidence ← observation).
 *   "unavailable"→ no sensor; stated honestly with a reason. Never fabricated.
 *
 * ── Evidence loop guardrail (ratified v1) ──────────────────────────────────────
 *
 *   Only this stage receives priorObservation (enforced structurally in pipeline.ts).
 *   When priorObservation is non-null (feedsNextCycle was true upstream), evidence
 *   is derived from it — the loop input takes precedence over fresh sensing so
 *   the arbitration guardrail ("prior observation is a CLAIM") stays anchored.
 *   Observation feeds basis only — never authority or execution.
 *
 * ── Evidence pre-state sensor (L3.S1 — Lane 3, Certify slice) ──────────────────
 *
 *   Outside the loop, evidence is sensed from reality: the read-only workspace
 *   pre-state sensor (fs-evidence-sensor.ts) reads what actually exists at every
 *   target path the understanding's executable operations name, under the SAME
 *   workspace root the executor would be bound to. The basis stage runs before
 *   ratification/execution in the canonical stage order, so this is always
 *   pre-state — the reality the human decides against, never the outcome.
 *
 *   The sensor root comes from `makeDecisionBasisPort(workspaceRoot)`: a surface
 *   passes its execution workspace (CLI --workspace / server GOVERNED_WORKSPACE);
 *   the default port senses `process.cwd()` — the same honest default the
 *   sourceOfRecord git sensor already uses, recorded verbatim in the value so
 *   the record states exactly which root was sensed.
 *
 *   Honest degradation (never fabricated): intent not understood → unavailable;
 *   understanding carries no executable operations → unavailable; workspace root
 *   does not exist → unavailable with the verbatim reason.
 *
 * ── Never throws ───────────────────────────────────────────────────────────────
 *
 *   Unexpected errors are wrapped and degrade the affected sub-section to
 *   unavailable. The outer section stays connected (constraints + runtimeState
 *   are always connected and cannot fail deterministically).
 */

import type {
  DecisionSection,
  DecisionBasisPayload,
  ExecutableOperation,
  ObservationPayload,
  UnderstandingPayload,
} from "../types.js";
import type { BasisStageContext } from "../pipeline.js";
import type { CursorOCDPolicy } from "../../cursor/types.js";
import { captureRepositoryProvenance } from "../../constitution/repository-provenance.js";
import { senseWorkspacePreState } from "./fs-evidence-sensor.js";
import { senseOcdPolicy } from "./ocd-policy-sensor.js";

// ─── sub-section builders ──────────────────────────────────────────────────────

/**
 * constraints — CONNECTED.
 *
 * Reads the real human-supplied constraints from the spine context.
 * An empty list is a genuine, connected fact: the human explicitly specified
 * none. We never add or remove constraints; we reflect them exactly.
 */
function buildConstraintsSubSection(
  constraints: readonly string[],
): DecisionSection<unknown> {
  return {
    status: "connected",
    value: { constraints },
  };
}

/**
 * sourceOfRecord — CONNECTED when git is available at `workspaceRoot`,
 * UNAVAILABLE otherwise.
 *
 * Calls the existing deterministic git sensor captureRepositoryProvenance()
 * (src/constitution/repository-provenance.ts). The sensor reads HEAD commit,
 * remote.origin.url, and working-tree dirty status. It never throws and
 * returns a stable all-null fact when the workspace is not a git repo.
 *
 * MUST use the same root as the evidence pre-state sensor (L3.S1 / handoff
 * `basisWorkspace`). Sensing process.cwd() while evidence senses a sandbox
 * would certify against the wrong repository (or Core's deploy checkout).
 */
function buildSourceOfRecordSubSection(workspaceRoot: string): DecisionSection<unknown> {
  try {
    const provenance = captureRepositoryProvenance(workspaceRoot);
    if (provenance.commit === null) {
      return {
        status: "unavailable",
        reason:
          "workspace is not a git repository, or the git binary is unavailable",
      };
    }
    return {
      status: "connected",
      value: provenance,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      reason: `repository provenance capture failed unexpectedly: ${message}`,
    };
  }
}

/**
 * runtimeState — CONNECTED.
 *
 * Reads deterministic, stable process facts available in any Node.js process.
 * Does NOT claim CI/test/build state or environment variables, since the
 * constitution's environment and dependencies classes are null stubs in v1.
 */
function buildRuntimeStateSubSection(): DecisionSection<unknown> {
  return {
    status: "connected",
    value: {
      nodeVersion: process.version,
      platform: process.platform,
    },
  };
}

/**
 * policy — CONNECTED via the OCD policy sensor (L3.S2) when a surface provides
 * its OCD policy, UNAVAILABLE otherwise.
 *
 * Policy is a distinct concept from constraints (human-supplied): policy is the
 * organisational rule set that governs decisions, and the OCD policy is its
 * constraint authority in core. The sensor READS the policy verbatim and runs
 * the proposed executable-op targets through the authority's own rule code
 * (evaluatePathsAgainstOCDPolicy) — never a reinterpretation. A violating
 * proposal surfaces as a verbatim conflict_detected clearance in the basis
 * BEFORE ratification: it informs H's decision, it does not gate it.
 *
 * Honest degradation: no policy provided by the surface → unavailable with a
 * reason. No executable ops to evaluate → still connected (the policy itself
 * is a real fact), with evaluatedPaths [] and NO fabricated verdict.
 */
function buildPolicySubSection(
  understanding: DecisionSection<UnderstandingPayload> | undefined,
  ocdPolicy: CursorOCDPolicy | null,
): DecisionSection<unknown> {
  if (ocdPolicy === null) {
    return {
      status: "unavailable",
      reason: "no OCD policy source provided by the surface",
    };
  }
  try {
    const ops = executableOpsFromUnderstanding(understanding) ?? [];
    return {
      status: "connected",
      value: senseOcdPolicy(ocdPolicy, ops),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      reason: `OCD policy sensing failed: ${message}`,
    };
  }
}

/**
 * Read the executable operations out of the prior accumulator's understanding
 * section, verbatim. Returns null when the understanding is not connected
 * (nothing was understood, so there are no targets to sense), and [] when it is
 * connected but carries no executable operations (e.g. a destructive intent
 * whose plan deliberately has no op in the v1 subset).
 */
function executableOpsFromUnderstanding(
  understanding: DecisionSection<UnderstandingPayload> | undefined,
): readonly ExecutableOperation[] | null {
  if (understanding === undefined || understanding.status === "unavailable") {
    return null;
  }
  const ops: ExecutableOperation[] = [];
  for (const plan of understanding.value.candidatePlans) {
    if (plan.operation !== undefined) {
      ops.push(plan.operation);
    }
  }
  return ops;
}

/**
 * evidence — DERIVED from priorObservation when the loop is active, CONNECTED
 * via the workspace pre-state sensor when the understanding carries executable
 * operations (L3.S1), UNAVAILABLE when there is nothing honest to sense.
 *
 * Loop precedence: the automatic loop (ratified v1) allows a prior observation
 * to feed the next cycle's Decision Basis as evidence. The pipeline enforces
 * that priorObservation is non-null only when the prior observation's
 * feedsNextCycle flag was true. When derived: the full prior ObservationPayload
 * is included in the value so the record carries the complete provenance chain,
 * not a summary reference; derivedFrom uses the "observation" stage name.
 *
 * Fresh sensing (no loop input): the pre-state sensor reads what exists at
 * every operation target under `workspaceRoot` — read-only, before
 * ratification/execution in the stage order, so always pre-state. Honest
 * degradation, never fabrication:
 *   - intent not understood            → unavailable (no targets exist to sense)
 *   - no executable ops in the plan    → unavailable (nothing in the executable
 *                                        subset to sense pre-state for)
 *   - workspace root does not exist    → unavailable (verbatim sensor reason)
 *
 * NOTE: src/evidence/ is intentionally not imported here (verify-rules Rule 13).
 */
function buildEvidenceSubSection(
  priorObservation: ObservationPayload | null,
  understanding: DecisionSection<UnderstandingPayload> | undefined,
  workspaceRoot: string,
): DecisionSection<unknown> {
  if (priorObservation !== null) {
    return {
      status: "derived",
      value: {
        source: "prior observation",
        observation: priorObservation,
      },
      derivedFrom: ["observation"],
    };
  }

  const ops = executableOpsFromUnderstanding(understanding);
  if (ops === null) {
    return {
      status: "unavailable",
      reason: "no evidence to sense: intent not understood, so no target paths exist",
    };
  }
  if (ops.length === 0) {
    return {
      status: "unavailable",
      reason:
        "no evidence to sense: the understanding carries no executable operations in the v1 subset",
    };
  }

  try {
    return {
      status: "connected",
      value: senseWorkspacePreState(workspaceRoot, ops),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      reason: `pre-state sensing failed: ${message}`,
    };
  }
}

// ─── public port ──────────────────────────────────────────────────────────────

/**
 * Build the Decision Basis stage port, optionally bound to an explicit
 * workspace root for the evidence pre-state sensor (L3.S1) and an OCD policy
 * for the policy sensor (L3.S2).
 *
 * `workspaceRoot === null` → the sensor reads `process.cwd()` at sense time —
 * the same honest default the sourceOfRecord git sensor uses. A surface that
 * executes into a sandbox (CLI --workspace / server GOVERNED_WORKSPACE) MUST
 * pass that root so the evidence describes the same reality the executor will
 * touch. The resolved root is recorded verbatim in the evidence value either
 * way, so the record always states which root was sensed.
 *
 * `ocdPolicy === null` → the policy sub-section stays honestly unavailable
 * (no surface named its policy source). A surface passes the SAME OCD policy
 * object it enforces (e.g. the CLI's DEFAULT_CURSOR_POLICY) so the basis
 * records the policy the decision is actually governed by.
 *
 * `prebuiltSourceOfRecord` — OPTIONAL surface-sensed SoR (e.g. GitHub API HEAD
 * for scm-github handoffs with no local git checkout). When present it is used
 * verbatim (gauge law: the surface already established the fact). When null,
 * the git sensor runs against `workspaceRoot ?? process.cwd()`.
 *
 * The outer section is always "connected" because constraints (real human
 * input) and runtimeState (deterministic process facts) are always connected.
 * Individual sub-sections may be unavailable (policy, evidence when nothing is
 * senseable) without degrading the outer, since the outer reflects the
 * aggregate fact that a real basis was assembled — not that every sub-section
 * is wired.
 *
 * Never throws. Unexpected failures in any sub-section degrade that sub-section
 * to unavailable; the outer remains connected.
 */
export function makeDecisionBasisPort(
  workspaceRoot: string | null,
  ocdPolicy: CursorOCDPolicy | null = null,
  prebuiltSourceOfRecord: DecisionSection<unknown> | null = null,
): (ctx: BasisStageContext) => Promise<DecisionSection<DecisionBasisPayload>> {
  return async (ctx: BasisStageContext): Promise<DecisionSection<DecisionBasisPayload>> => {
    try {
      const sensedRoot = workspaceRoot ?? process.cwd();
      const evidence = buildEvidenceSubSection(
        ctx.priorObservation,
        ctx.prior.understanding,
        sensedRoot,
      );
      const policy = buildPolicySubSection(ctx.prior.understanding, ocdPolicy);
      const constraints = buildConstraintsSubSection(ctx.humanIntent.constraints);
      const sourceOfRecord =
        prebuiltSourceOfRecord !== null
          ? prebuiltSourceOfRecord
          : buildSourceOfRecordSubSection(sensedRoot);
      const runtimeState = buildRuntimeStateSubSection();

      const value: DecisionBasisPayload = {
        evidence,
        policy,
        constraints,
        sourceOfRecord,
        runtimeState,
        // Explicit Invocation Lineage (INV-EIL-4): the declared reference edges enter
        // the basis as kind-banded claims, recorded verbatim from the kernel-resolved
        // set. Empty array when the invocation declared none -- an honest fact, never
        // fabricated. Truth Arbitration reads these to re-arbitrate and grade them.
        references: ctx.references,
      };

      return { status: "connected", value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        reason: `decision basis stage failed unexpectedly: ${message}`,
      };
    }
  };
}

/**
 * Run the Decision Basis stage with the default (cwd-sensing) port. Kept as a
 * named function so existing call sites and tests remain source-compatible.
 */
export async function buildDecisionBasisSection(
  ctx: BasisStageContext,
): Promise<DecisionSection<DecisionBasisPayload>> {
  return makeDecisionBasisPort(null)(ctx);
}

/**
 * Convenience alias so the adapter can be passed directly as
 * `ports.decisionBasis` in a `runGovernedDecisionSpine()` call.
 */
export const decisionBasisPort = buildDecisionBasisSection;
