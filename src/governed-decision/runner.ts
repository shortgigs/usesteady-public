/**
 * Governed Decision Runner — the runtime that turns the kernel library into a
 * usable decision lifecycle.
 *
 * Canonical design: docs/architecture/USESTEADY_GOVERNED_DECISION_SURFACE_V1.md
 *
 * The kernel spine (`runGovernedDecisionSpine`) is pure and port-injected. This
 * module assembles the REAL deterministic stage ports and exposes the two
 * lifecycle entrypoints a surface (CLI/Portal) needs:
 *
 *   produceDraft(intent)                -> an immutable draft record
 *   produceFinal(intent, humanDecision) -> an immutable final record
 *
 * ── Authority boundary ────────────────────────────────────────────────────────
 *
 *   This module assembles ports and runs the spine. It does NOT decide anything.
 *   The ONLY authority input is `humanDecision`, supplied by the caller (a human
 *   via a surface) and passed verbatim to `makeRatificationPort`. The runner
 *   never fabricates a decision, never sets a section status, never computes a
 *   fingerprint itself.
 *
 * ── Atomic two-record model ───────────────────────────────────────────────────
 *
 *   A draft is a full spine run with NO ratification decision: understanding,
 *   constitution, decisionBasis and truthArbitration populate; ratification,
 *   execution and observation are honestly `unavailable`.
 *
 *   A final is a full spine run WITH the human's ratification decision injected.
 *   The decision is anchored to the draft's constitution `stampFingerprint`; the
 *   spine recomputes that fingerprint deterministically and the ratification port
 *   accepts the decision only if they match (fail closed otherwise).
 *
 * ── Honest execution/observation ──────────────────────────────────────────────
 *
 *   By DEFAULT no `DeterministicExecutor` or `RealityProbe` is wired: execution
 *   stays `unavailable` and observation's `realityVerdict` stays `unknown` even
 *   after approval (gauge law on a live surface, not a gap). A surface MAY pass an
 *   explicit `executor` to `produceFinal` (Tier 1.1b: the sandboxed FS executor,
 *   opt-in only) — it actuates the approved ops only after the spine's fail-closed
 *   gate confirms approval, and the executor enforces its own containment. A
 *   surface MAY also pass an explicit `realityProbe` (Tier 1.2a: the read-only FS
 *   reality probe over the same workspace) — it INDEPENDENTLY verifies the
 *   actuated ops against the real filesystem so `realityVerdict` becomes a real
 *   `agree`/`disagree` (reality's final veto). Both are off-by-default and carry
 *   no authority; they inform their sections only.
 */

import { runGovernedDecisionSpine } from "./pipeline.js";
import type {
  DecisionSection,
  GovernedDecisionRecord,
  HumanIntent,
  ObservationPayload,
  Reference,
} from "./types.js";

import {
  understandingPort,
  makeUnderstandingPort,
  type CandidatePlanInput,
} from "./stages/understanding.js";
import type { FileReplacePin } from "./stages/replace-pin.js";
import type { FileDeletePin } from "./stages/delete-pin.js";
import type { FileRenamePin } from "./stages/rename-pin.js";
import { constitutionPort } from "./stages/constitution.js";
import { decisionBasisPort, makeDecisionBasisPort } from "./stages/decision-basis.js";
import type { CursorOCDPolicy } from "../cursor/types.js";
import { truthArbitrationPort } from "./stages/truth-arbitration.js";
import {
  makeRatificationPort,
  ratificationPort,
  type HumanRatification,
} from "./stages/ratification.js";
import {
  executionPort,
  makeExecutionPort,
  type DeterministicExecutor,
  type BoundarySink,
} from "./stages/execution.js";
import { makeObservationPort, observationPort, type RealityProbe } from "./stages/observation.js";
import type { ScopeSensor } from "./stages/scope-snapshot.js";

/**
 * The human's ratification, as captured by a surface. Re-exported shape so a
 * surface depends on the runner, not on a stage internal.
 */
export type { HumanRatification } from "./stages/ratification.js";

/**
 * Executor seam re-exports. Surfaces (CLI/HTTP/server) opt into actuation by
 * passing an executor to {@link produceFinal}; they depend on the runner, NOT on
 * stage internals (enforced by the cli/http boundary tests). The sandboxed FS
 * executor is the only v1 actuator.
 */
export { makeSandboxedFsExecutor } from "./stages/fs-executor.js";
export { makeHumanAttestationExecutor } from "./stages/human-attestation-executor.js";
export { makeDocumentRecordExecutor } from "./stages/document-record-executor.js";
export { makeDocumentRecordRealityProbe } from "./stages/document-record-reality-probe.js";
export type { DeterministicExecutor, ExecutorOutcome, BoundarySink } from "./stages/execution.js";
export { makeBoundaryJsonlSink } from "../execution/boundary-observer.js";

/**
 * Reality-probe seam re-exports. Surfaces opt into INDEPENDENT reality
 * verification by passing a probe to {@link produceFinal}; they depend on the
 * runner, NOT on stage internals (cli/http boundary tests). The filesystem probe
 * is the only v1 sensor.
 */
export { makeFsRealityProbe } from "./stages/fs-reality-probe.js";
export type { RealityProbe } from "./stages/observation.js";

/**
 * Observation-scope sensor seam re-export (Collateral Mutation Closure V1). A
 * surface that enables execution MAY also pass `makeFsScopeSensor(workspace)`
 * to {@link produceFinal} so the execution stage captures the DECLARED
 * observation scope (derived purely from the ratified ops) and its
 * pre-actuation snapshot BEFORE the executor runs — the evidence the reality
 * probe later reconciles against to detect unauthorized in-scope mutation.
 * Observer-side read path; the executor never sees it.
 */
export { makeFsScopeSensor } from "./stages/scope-snapshot.js";
export type { ScopeSensor, ScopeSensing } from "./stages/scope-snapshot.js";

/**
 * Candidate-plan seam re-exports (AI_SEAMS_V1 seam 2 — L2.S3). A surface MAY
 * inject a candidate plan (canonical deterministic phrases, plain data, zero
 * authority) into a draft/final run; the understanding stage re-validates every
 * phrase deterministically and fails closed. `candidatePlanFromRecord` lets a
 * ratification surface reconstruct the plan from the reviewed draft so the
 * final reproduces the identical stamped fingerprint. Surfaces depend on the
 * runner, NOT on stage internals (cli/http boundary tests).
 */
export { candidatePlanFromRecord } from "./stages/understanding.js";
export type { CandidatePlanInput } from "./stages/understanding.js";

/**
 * Replace-pin seam re-exports (L4.S1 — governed FS update/replace). A surface
 * senses the pin against its execution workspace at DECIDE time
 * (`senseReplacePin`) and reconstructs it verbatim from the reviewed draft at
 * RATIFY time (`replacePinFromRecord`) — never re-sensed, so the final's
 * fingerprint anchors to exactly what the human saw and a file that changed
 * under the approval is refused by the EXECUTOR's hash gate. Surfaces depend
 * on the runner, NOT on stage internals (cli/http boundary tests).
 */
export { senseReplacePin, replacePinFromRecord } from "./stages/replace-pin.js";
export type { FileReplacePin } from "./stages/replace-pin.js";

/**
 * Delete-pin seam re-exports (A1 — governed FS delete). Same discipline as the
 * replace pin: sensed at DECIDE time against the execution workspace
 * (`senseDeletePin`), reconstructed verbatim from the reviewed draft at RATIFY
 * time (`deletePinFromRecord`) — never re-sensed. A file that changed under
 * the approval is refused by the EXECUTOR's hash gate.
 */
export { senseDeletePin, deletePinFromRecord } from "./stages/delete-pin.js";
export type { FileDeletePin } from "./stages/delete-pin.js";

/**
 * Rename-pin seam re-exports (R1 — governed FS rename). Same discipline as the
 * replace and delete pins: sensed at DECIDE time against the execution
 * workspace (`senseRenamePin`), reconstructed verbatim from the reviewed draft
 * at RATIFY time (`renamePinFromRecord`) — never re-sensed. A source file that
 * changed under the approval is refused by the EXECUTOR's hash gate.
 */
export { senseRenamePin, renamePinFromRecord } from "./stages/rename-pin.js";
export type { FileRenamePin } from "./stages/rename-pin.js";

/**
 * Assemble the stage ports shared by draft and final runs.
 *
 * The four deterministic stages (understanding/constitution/decisionBasis/
 * truthArbitration) are identical across a draft and its final, which keeps the
 * constitution fingerprint stable and makes the two-record model sound.
 *
 * Execution and observation use their HONEST DEFAULT ports (no actuator/probe
 * wired in v1): execution -> "deterministic execution SDK not wired", observation
 * -> "cannot observe". We pass them explicitly (rather than letting the spine
 * fall back to its generic "stage not yet wired (Phase C)" placeholder) so a
 * surface shows the real, intended reason.
 *
 * Ratification is supplied per-run (the honest null port for a draft, the human
 * decision for a final) so it is never accidentally fabricated.
 */
function basePorts(
  executor: DeterministicExecutor | null = null,
  realityProbe: RealityProbe | null = null,
  candidatePlan: CandidatePlanInput | null = null,
  basisWorkspace: string | null = null,
  basisPolicy: CursorOCDPolicy | null = null,
  replacePin: FileReplacePin | null = null,
  deletePin: FileDeletePin | null = null,
  renamePin: FileRenamePin | null = null,
  basisSourceOfRecord: DecisionSection<unknown> | null = null,
  scopeSensor: ScopeSensor | null = null,
  boundarySink: BoundarySink | null = null,
) {
  return {
    // Deterministic-first: the port runs the parser before ever looking at an
    // injected candidate plan, and re-validates every plan phrase itself. With
    // no plan and no pins this IS the v1 deterministic-only port. The replace
    // pin (L4.S1), delete pin (A1), and rename pin (R1) are plain injected
    // data: they let a parser-classified replace/delete/rename intent carry a
    // structured op anchored to the sensed file content.
    understanding:
      candidatePlan === null && replacePin === null && deletePin === null && renamePin === null
        ? understandingPort
        : makeUnderstandingPort(candidatePlan, replacePin, deletePin, renamePin),
    constitution: constitutionPort,
    // Evidence pre-state sensor (L3.S1) + OCD policy sensor (L3.S2): bound to
    // the surface's execution workspace / enforced policy when named, else the
    // default port (cwd-sensing evidence, policy honestly unavailable).
    // Optional prebuilt SoR (scm-github API HEAD) when the surface has no
    // local git checkout. Read-only; the basis stage runs before ratification/execution.
    decisionBasis:
      basisWorkspace === null && basisPolicy === null && basisSourceOfRecord === null
        ? decisionBasisPort
        : makeDecisionBasisPort(basisWorkspace, basisPolicy, basisSourceOfRecord),
    truthArbitration: truthArbitrationPort,
    // Honest default: no executor -> execution stays "unavailable". An injected
    // executor (e.g. the sandboxed FS executor) actuates only AFTER the spine's
    // fail-closed gate confirms ratification is connected + approved. The
    // optional scope sensor (Collateral Mutation Closure V1) captures the
    // declared observation scope + pre-actuation snapshot BEFORE actuation.
    execution: executor === null ? executionPort : makeExecutionPort(executor, scopeSensor, boundarySink),
    // Honest default: no probe -> realityVerdict stays "unknown" (no sensor). An
    // injected probe (e.g. the read-only FS reality probe) independently verifies
    // the actuated ops against the real filesystem — reality's final veto.
    observation: realityProbe === null ? observationPort : makeObservationPort(realityProbe),
  } as const;
}

/**
 * Automatic-loop input (ratified v1). A prior cycle's observation, sourced by a
 * surface from a STORED prior decision, offered to feed THIS cycle's Decision
 * Basis as lowest-authority evidence.
 *
 * This carries NO authority. The spine's `eligiblePrior` gate decides whether it
 * is actually fed: only an observation with `feedsNextCycle === true` is injected,
 * and only into the `decisionBasis` port (never ratification or execution). When
 * ineligible or absent, the basis evidence stays honestly `unavailable` and the
 * record's `priorObservationRef` is `null`. The runner threads this verbatim; it
 * never decides eligibility itself.
 */
export type LoopInput = {
  readonly priorObservation?: ObservationPayload | null;
  /** Provenance: the recordId of the prior decision whose observation is offered. */
  readonly priorObservationRef?: string | null;
  /**
   * Explicit Invocation Lineage (INV-EIL-2): declared reference inputs this
   * invocation depends on. Recorded as lineage edges with a kind-derived
   * authority band; the caller cannot self-certify authority (INV-EIL-5).
   */
  readonly references?: readonly Reference[];
};

/**
 * Produce an immutable DRAFT record: the machine's proposal awaiting human
 * ratification. Ratification is `unavailable` with the honest "awaiting human
 * ratification" reason (ratificationPort === makeRatificationPort(null));
 * execution/observation are `unavailable` (no decision approved, no actuator).
 *
 * `loop` optionally offers a prior observation to feed this cycle's basis. The
 * spine's guardrail gates eligibility; the runner only threads the input.
 *
 * `options.candidatePlan` (AI_SEAMS_V1 seam 2) optionally offers a surface-
 * validated candidate plan; the understanding port re-validates it and uses it
 * ONLY when the deterministic parser cannot classify the goal. Plain data,
 * zero authority — the runner only threads it.
 */
export type ProduceDraftOptions = {
  readonly candidatePlan?: CandidatePlanInput | null;
  /**
   * OPTIONAL workspace root for the evidence pre-state sensor (L3.S1). A
   * surface that will execute into a sandbox passes that root here so the
   * evidence the human reviews describes the SAME reality the executor would
   * touch. Omitted → the default port senses process.cwd() (recorded verbatim
   * in the evidence value either way).
   */
  readonly basisWorkspace?: string | null;
  /**
   * OPTIONAL OCD policy for the basis policy sensor (L3.S2). A surface passes
   * the SAME policy object it enforces so the basis records the policy this
   * decision is actually governed by, and the proposed op targets are
   * evaluated through the constraint authority's own rule code. Omitted → the
   * policy sub-section stays honestly unavailable.
   */
  readonly basisPolicy?: CursorOCDPolicy | null;
  /**
   * OPTIONAL replace pin (L4.S1). A surface senses it against the SAME
   * workspace the executor would actuate (`senseReplacePin`) so a replace
   * intent carries a structured op whose approval is anchored to the file
   * content the human actually saw. Plain data, zero authority — the runner
   * only threads it. Omitted / null → a replace intent produces a connected
   * plan with no executable op (the pre-L4.S1 behavior).
   */
  readonly replacePin?: FileReplacePin | null;
  /**
   * OPTIONAL delete pin (A1). A surface senses it against the SAME workspace
   * the executor would actuate (`senseDeletePin`) so a delete intent carries a
   * structured op whose approval is anchored to the file content the human
   * actually saw. Plain data, zero authority — the runner only threads it.
   * Omitted / null → a delete intent produces a connected plan with no
   * executable op (the pre-A1 behavior).
   */
  readonly deletePin?: FileDeletePin | null;
  /**
   * OPTIONAL rename pin (R1). A surface senses it against the SAME workspace
   * the executor would actuate (`senseRenamePin`) so a rename intent carries
   * a structured op whose approval is anchored to the SOURCE file content the
   * human actually saw. Plain data, zero authority — the runner only threads
   * it. Omitted / null → a rename intent produces a connected plan with no
   * executable op (the pre-R1 behavior).
   */
  readonly renamePin?: FileRenamePin | null;
  /**
   * OPTIONAL prebuilt source-of-record section (USESTEADY_PORTAL_HANDOFF_CERT_V1).
   * Surfaces without a local git checkout (scm-github) pass a GitHub API HEAD
   * fact here so Truth Arbitration can grade against the real repo of record.
   * Omitted → git sensor at basisWorkspace / cwd.
   */
  readonly basisSourceOfRecord?: DecisionSection<unknown> | null;
};

export async function produceDraft(
  intent: HumanIntent,
  loop: LoopInput = {},
  options: ProduceDraftOptions = {},
): Promise<GovernedDecisionRecord> {
  return runGovernedDecisionSpine({
    humanIntent: intent,
    priorObservation: loop.priorObservation ?? null,
    priorObservationRef: loop.priorObservationRef ?? null,
    references: loop.references ?? [],
    ports: {
      ...basePorts(
        null,
        null,
        options.candidatePlan ?? null,
        options.basisWorkspace ?? null,
        options.basisPolicy ?? null,
        options.replacePin ?? null,
        options.deletePin ?? null,
        options.renamePin ?? null,
        options.basisSourceOfRecord ?? null,
      ),
      ratification: ratificationPort,
    },
  });
}

/**
 * Produce an immutable FINAL record: the same proposal with the human's
 * ratification decision injected.
 *
 * The decision MUST carry the `ratifiedFingerprint` the human actually reviewed
 * (the draft's `constitution.stampFingerprint`). The spine recomputes the
 * constitution deterministically; the ratification port accepts the decision
 * only if the fingerprints match. On mismatch (intent changed, stale approval),
 * ratification is `unavailable` and the spine's fail-closed gate blocks
 * execution — you cannot ratify one decision and execute another.
 */
/**
 * Options for {@link produceFinal}.
 *
 * `executor` is the OPTIONAL, operator-supplied actuator. When omitted, execution
 * stays honestly `unavailable` (the v1 default). When supplied (e.g. a sandboxed
 * FS executor the operator explicitly enabled), it actuates the approved ops —
 * but ONLY after the spine's fail-closed gate confirms approval, and the executor
 * itself enforces its own containment.
 */
export type ProduceFinalOptions = {
  readonly executor?: DeterministicExecutor;
  /**
   * OPTIONAL, operator-supplied INDEPENDENT reality sensor. When omitted,
   * observation's `realityVerdict` stays honestly `unknown` (the v1 default —
   * silence, not agreement). When supplied (e.g. the read-only FS reality probe
   * over the SAME workspace the executor actuated), it verifies the actuated ops
   * against the real filesystem and can return `disagree` — reality's final veto.
   * The probe has no authority; it informs the observation section only.
   */
  readonly realityProbe?: RealityProbe;
  /**
   * OPTIONAL automatic-loop input. A prior cycle's observation (sourced by the
   * surface from a stored decision) offered to feed THIS cycle's Decision Basis.
   * Carries no authority — the spine gates eligibility; the runner only threads
   * it. For a deferred ratification this MUST match what the reviewed draft was
   * fed, so basis stays consistent between draft and final.
   */
  readonly priorObservation?: ObservationPayload | null;
  /** Provenance ref paired with {@link priorObservation}. */
  readonly priorObservationRef?: string | null;
  /**
   * Explicit Invocation Lineage (INV-EIL-2): declared reference inputs. For a
   * deferred ratification this SHOULD match what the reviewed draft declared, so
   * lineage stays consistent between draft and final.
   */
  readonly references?: readonly Reference[];
  /**
   * OPTIONAL candidate plan (AI_SEAMS_V1 seam 2). For a deferred ratification
   * this MUST be the plan reconstructed from the reviewed draft
   * (`candidatePlanFromRecord`) so the final's understanding — and therefore
   * the constitution fingerprint the ratification anchors to — reproduces
   * EXACTLY what the human reviewed. The understanding port re-validates every
   * phrase deterministically and ignores the plan for parser-parseable goals.
   */
  readonly candidatePlan?: CandidatePlanInput | null;
  /**
   * OPTIONAL workspace root for the evidence pre-state sensor (L3.S1) —
   * normally the SAME root the executor is bound to. The final re-senses at
   * ratify time; the basis stage runs before execution in the spine order, so
   * what it records is still pre-state (the reality that existed at the moment
   * of ratification). The basis is not part of the stamped fingerprint, so
   * this never breaks ratification anchoring.
   */
  readonly basisWorkspace?: string | null;
  /**
   * OPTIONAL OCD policy for the basis policy sensor (L3.S2) — normally the
   * SAME policy the ratifying surface enforces. The basis is not part of the
   * stamped fingerprint, so this never breaks ratification anchoring.
   */
  readonly basisPolicy?: CursorOCDPolicy | null;
  /**
   * OPTIONAL replace pin (L4.S1). For a deferred ratification this MUST be the
   * pin reconstructed from the reviewed draft (`replacePinFromRecord`) —
   * NEVER re-sensed — so the final's understanding, and therefore the
   * constitution fingerprint the ratification anchors to, reproduces EXACTLY
   * the pinned op the human reviewed. A file that changed since the pin was
   * sensed is then refused by the executor's hash gate (an honest per-op
   * failure in the record), not silently re-anchored.
   */
  readonly replacePin?: FileReplacePin | null;
  /**
   * OPTIONAL delete pin (A1). For a deferred ratification this MUST be the
   * pin reconstructed from the reviewed draft (`deletePinFromRecord`) — NEVER
   * re-sensed — so the final's understanding, and therefore the constitution
   * fingerprint the ratification anchors to, reproduces EXACTLY the pinned op
   * the human reviewed. A file that changed since the pin was sensed is then
   * refused by the executor's hash gate (an honest per-op failure in the
   * record), not silently re-anchored.
   */
  readonly deletePin?: FileDeletePin | null;
  /**
   * OPTIONAL rename pin (R1). For a deferred ratification this MUST be the
   * pin reconstructed from the reviewed draft (`renamePinFromRecord`) — NEVER
   * re-sensed — so the final's understanding, and therefore the constitution
   * fingerprint the ratification anchors to, reproduces EXACTLY the pinned op
   * the human reviewed. A source file that changed since the pin was sensed
   * is then refused by the executor's hash gate (an honest per-op failure in
   * the record), not silently re-anchored.
   */
  readonly renamePin?: FileRenamePin | null;
  /**
   * OPTIONAL prebuilt source-of-record section (USESTEADY_PORTAL_HANDOFF_CERT_V1).
   * See {@link ProduceDraftOptions.basisSourceOfRecord}.
   */
  readonly basisSourceOfRecord?: DecisionSection<unknown> | null;
  /**
   * OPTIONAL observer-side scope sensor (Collateral Mutation Closure V1) —
   * normally `makeFsScopeSensor(workspace)` over the SAME root as the
   * executor. When supplied, the execution stage captures the DECLARED
   * observation scope (a pure derivative of the ratified ops — no fingerprint
   * change) and its pre-actuation snapshot BEFORE the executor runs, and the
   * reality probe reconciles the post-state against it: any unauthorized
   * in-scope delta yields `disagree`. Omitted → the scope fields stay honestly
   * absent (pre-closure behavior).
   */
  readonly scopeSensor?: ScopeSensor | null;
  /**
   * OPTIONAL process-local receiving-boundary sink. When supplied with an
   * executor, the execution port observes the frozen ops at the executor
   * receive seam before actuation. Carries no authority; never exposed to
   * executors or request input. Absent → no admissible receiving record.
   */
  readonly boundarySink?: BoundarySink | null;
};

export async function produceFinal(
  intent: HumanIntent,
  humanDecision: HumanRatification,
  options: ProduceFinalOptions = {},
): Promise<GovernedDecisionRecord> {
  return runGovernedDecisionSpine({
    humanIntent: intent,
    priorObservation: options.priorObservation ?? null,
    priorObservationRef: options.priorObservationRef ?? null,
    references: options.references ?? [],
    ports: {
      ...basePorts(
        options.executor ?? null,
        options.realityProbe ?? null,
        options.candidatePlan ?? null,
        options.basisWorkspace ?? null,
        options.basisPolicy ?? null,
        options.replacePin ?? null,
        options.deletePin ?? null,
        options.renamePin ?? null,
        options.basisSourceOfRecord ?? null,
        options.scopeSensor ?? null,
        options.boundarySink ?? null,
      ),
      ratification: makeRatificationPort(humanDecision),
    },
  });
}

/**
 * Read the stamped fingerprint a human must anchor their ratification to.
 *
 * Returns the draft's `constitution.stampFingerprint` when the constitution is
 * connected, else `null` (e.g. understanding was unavailable, so there is no
 * stamped decision to ratify). A surface uses this to build the
 * `HumanRatification.ratifiedFingerprint` — it never computes a fingerprint
 * itself.
 */
export function ratifiableFingerprint(draft: GovernedDecisionRecord): string | null {
  const constitution = draft.constitution;
  if (constitution.status === "connected") {
    return constitution.value.stampFingerprint;
  }
  return null;
}
