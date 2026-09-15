/**
 * Deterministic Execution SDK stage — spine port v1.
 *
 * ── Design principle: honesty over optimism ────────────────────────────────
 *
 *   There is NO live real-world actuator wired into the kernel spine. A port
 *   that claimed `ranWhatWasApproved: true` without a real executor would be
 *   fabricating execution — a false record of what happened. That is a
 *   governance violation of the gauge law: "invented is unrepresentable."
 *
 *   Therefore the default export (`executionPort`) is `makeExecutionPort(null)`,
 *   which returns `unavailable` ("deterministic execution SDK not wired; nothing
 *   executed"). This is the honest state of the world until a real deterministic
 *   executor is injected.
 *
 * ── Why approvedSteps derive from the ratified understanding ───────────────
 *
 *   The canonical architecture states: "The SDK executes only what was approved."
 *   What was approved is the understanding that the constitution fingerprinted and
 *   the human ratified. The ratification section anchors the human decision to a
 *   specific `stampFingerprint`, which in turn binds to the understanding payload
 *   (humanIntent + understanding are the inputs that produced the stamp).
 *
 *   Therefore: approved steps = the steps derived from `ctx.prior.understanding`.
 *   Executing these steps = executing exactly what was ratified. Using any other
 *   source for the step list would break the "only what was approved" invariant.
 *
 * ── How `ranWhatWasApproved` is the structural proof ──────────────────────
 *
 *   A faithful executor receives exactly the approved steps and returns exactly
 *   those steps (same length, same order, same values). The `ranWhatWasApproved`
 *   flag is computed by strict array equality: if an executor adds, drops, or
 *   reorders steps, this is `false` — the record captures the drift faithfully
 *   rather than concealing it. This is the structural, in-record proof that
 *   execution ran only what was approved.
 *
 * ── Executor seam ──────────────────────────────────────────────────────────
 *
 *   `DeterministicExecutor` is an injectable seam. The kernel spine is agnostic
 *   to the actuator; real actuators (filesystem, shell, etc.) are injected by
 *   higher-level layers in future Phase C slices. The seam contract requires the
 *   executor to report its own `deterministic` flag — if it uses time, random, or
 *   uncontrolled IO, it must set `deterministic: false`, and the record will
 *   reflect that honestly.
 *
 * ── Gauge law ──────────────────────────────────────────────────────────────
 *
 *   "connected"   → executor was injected, ran, and produced a result. The
 *                   `ranWhatWasApproved` and `deterministic` flags faithfully
 *                   reflect what the executor reported.
 *   "unavailable" → one of: no executor injected (honest default), no connected
 *                   understanding to derive approved steps from, or an unexpected
 *                   error. Reason is explicit in each case.
 *   "derived"     → not used here; execution is not derived from other sections,
 *                   it is an external actuation result.
 *
 * ── Never throws ───────────────────────────────────────────────────────────
 *
 *   Unexpected errors are caught and degrade the section to unavailable so the
 *   spine is never thrown into.
 */

import type {
  DecisionSection,
  ExecutionPayload,
  ExecutionOpResult,
  ExecutableOperation,
  ScopeSnapshotEntry,
  UnderstandingPayload,
} from "../types.js";
import type { BaseStageContext } from "../pipeline.js";
import { hollowContentOmissionReason } from "./understanding.js";
import type { ScopeSensor } from "./scope-snapshot.js";
import {
  makeGovernedExecutorBoundaryObserver,
  type BoundarySink,
} from "../../execution/boundary-observer.js";

export type { BoundarySink };

// ─── Executor seam ─────────────────────────────────────────────────────────────

/**
 * The outcome an executor reports back to the port.
 *
 *   ranOps  — the ops it ACTUALLY actuated successfully, in order. A faithful
 *             executor returns exactly the approved ops; a refusal/error drops
 *             that op from ranOps (so `ranWhatWasApproved` becomes false).
 *   results — per-op record of ran/failed + detail (transparency; never hidden).
 *   deterministic — the executor's honest self-report. A real-IO executor MUST
 *             set this false; only a pure/no-IO executor may set it true.
 */
export type ExecutorOutcome = {
  readonly ranOps: readonly ExecutableOperation[];
  readonly results: readonly ExecutionOpResult[];
  readonly deterministic: boolean;
};

/**
 * A deterministic executor: given the approved STRUCTURED operations, returns
 * which ops it actually ran, a per-op result log, and whether the run was
 * deterministic. A faithful executor runs EXACTLY the approved ops, in order.
 *
 * The ops are the structured, fingerprint-bound operations carried on the
 * ratified understanding (Tier 1.1a) — NOT display strings — so "execute only
 * what was approved" is structural, not textual.
 *
 * May be SYNC or ASYNC. The result may be an `ExecutorOutcome` or a
 * `Promise<ExecutorOutcome>`; `makeExecutionPort` awaits it. Sync actuators
 * (filesystem) return the value directly; async actuators (network/REST — e.g. a
 * source-control PR/MR actuator) return a promise. `await` on a sync value is a
 * no-op, so existing sync executors remain valid without change.
 */
export type DeterministicExecutor = (
  approvedOps: readonly ExecutableOperation[],
) => ExecutorOutcome | Promise<ExecutorOutcome>;

// ─── Op derivation ─────────────────────────────────────────────────────────────

/**
 * Derive the approved operation list from the ratified understanding, in order.
 *
 * Only `candidatePlans[].operation` entries that the parser actually produced are
 * included (Tier 1.1a populates the non-destructive subset). Plans without an
 * operation (destructive/non-executable intents) contribute nothing — never
 * fabricated, never reordered. This is the anchoring: these ops are exactly what
 * the constitution fingerprinted and the human ratified.
 */
function deriveApprovedOps(understanding: UnderstandingPayload): readonly ExecutableOperation[] {
  const ops: ExecutableOperation[] = [];
  for (const plan of understanding.candidatePlans) {
    if (plan.operation !== undefined) ops.push(plan.operation);
  }
  return ops;
}

/** Human-readable label for an op (display only; derived from the op's own fields). */
function opLabel(op: ExecutableOperation): string {
  if (op.kind === "create_file") {
    return `${op.kind}: ${op.path} (${op.content.length} bytes)`;
  }
  if (op.kind === "replace_in_file" || op.kind === "delete_file") {
    return `${op.kind}: ${op.path} (pinned pre-state ${op.expectedPriorSha256.slice(0, 8)}...)`;
  }
  if (op.kind === "rename_file") {
    return `${op.kind}: ${op.path} -> ${op.toPath} (pinned pre-state ${op.expectedPriorSha256.slice(0, 8)}...)`;
  }
  if (op.kind === "human_attest" || op.kind === "document_record") {
    return `${op.kind}: ${op.statement}`;
  }
  return `${op.kind}: ${op.path}`;
}

// ─── Structural equality helper ────────────────────────────────────────────────

/**
 * Structural op equality: same length, same order, same kind+path (+content
 * for create_file; +find/replaceWith/pinned hashes for replace_in_file;
 * +pinned hash for delete_file; +toPath/pinned hash for rename_file).
 * Certifies `ranWhatWasApproved`. Any addition, drop, reorder, or field
 * change → false.
 */
function opsEqual(a: readonly ExecutableOperation[], b: readonly ExecutableOperation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind !== y.kind || x.path !== y.path) return false;
    if (x.kind === "create_file" && y.kind === "create_file" && x.content !== y.content) {
      return false;
    }
    if (
      x.kind === "replace_in_file" &&
      y.kind === "replace_in_file" &&
      (x.find !== y.find ||
        x.replaceWith !== y.replaceWith ||
        x.expectedPriorSha256 !== y.expectedPriorSha256 ||
        x.expectedPostSha256 !== y.expectedPostSha256)
    ) {
      return false;
    }
    if (
      x.kind === "delete_file" &&
      y.kind === "delete_file" &&
      x.expectedPriorSha256 !== y.expectedPriorSha256
    ) {
      return false;
    }
    if (
      x.kind === "rename_file" &&
      y.kind === "rename_file" &&
      (x.toPath !== y.toPath || x.expectedPriorSha256 !== y.expectedPriorSha256)
    ) {
      return false;
    }
    if (
      x.kind === "human_attest" &&
      y.kind === "human_attest" &&
      (x.statement !== y.statement || x.executorClass !== y.executorClass)
    ) {
      return false;
    }
    if (
      x.kind === "document_record" &&
      y.kind === "document_record" &&
      (x.statement !== y.statement || x.executorClass !== y.executorClass)
    ) {
      return false;
    }
  }
  return true;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an execution port from an injected deterministic executor (or `null`
 * when no actuator has been wired yet).
 *
 * Why a factory?
 *   The executor is external to the kernel spine (like the human decision in
 *   ratification). Capturing it at construction time keeps the port signature
 *   `(ctx: BaseStageContext) => Promise<DecisionSection<ExecutionPayload>>`
 *   without leaking actuator wiring into the spine itself.
 *
 * Port behavior:
 *
 *   1. `ctx.prior.understanding` is absent or not "connected"
 *      → unavailable: "no approved plan to execute: understanding is not connected"
 *      There is nothing to execute; deriving steps from an unavailable understanding
 *      would be fabrication.
 *
 *   2. `executor === null`
 *      → unavailable: "deterministic execution SDK not wired; nothing executed
 *        (execution is opt-in — no executor was provided for this decision)"
 *      The honest default, made actionable: it states execution is a deliberate
 *      opt-in, not a failure. The spine already produced a fully-ratified record;
 *      execution is just not actuated until a real executor is injected.
 *      (Note: the spine's fail-closed gate ensures we are never called unless
 *      ratification is connected+approved, but we are still self-defensive here.)
 *
 *   3. Executor injected and understanding connected
 *      → call executor(approvedSteps), certify ranWhatWasApproved by strict
 *        array equality, and return connected.
 *
 *   4. Any unexpected error
 *      → unavailable with the error message.
 *
 * ── Observation scope sensor (Collateral Mutation Closure V1) ──────────────
 *
 *   When a `ScopeSensor` is injected alongside the executor, the stage captures
 *   the DECLARED observation scope and its pre-actuation snapshot BEFORE the
 *   executor is invoked, and persists both on the payload. The sensor is
 *   observer-side read path (see scope-snapshot.ts): the executor never
 *   receives it, never sees its output, and cannot enlarge, shrink, or
 *   substitute the scope — the payload fields are built here, from the
 *   kernel's own `approvedOps`, before actuation. The scope is a pure
 *   derivative of the ratified (fingerprinted) ops, so this binding adds no
 *   new ratification input. Sensor failure degrades to an explicit
 *   `observationScopeError` — never a fabricated snapshot, never a silent
 *   skip, and never a reason to block the (already-approved) actuation.
 */
export function makeExecutionPort(
  executor: DeterministicExecutor | null,
  scopeSensor: ScopeSensor | null = null,
  boundarySink: BoundarySink | null = null,
): (ctx: BaseStageContext) => Promise<DecisionSection<ExecutionPayload>> {
  return async (ctx: BaseStageContext): Promise<DecisionSection<ExecutionPayload>> => {
    try {
      // ── Guard 1: understanding must be connected ──────────────────────────
      const understanding = ctx.prior.understanding;
      if (understanding === undefined || understanding.status !== "connected") {
        return {
          status: "unavailable",
          reason: "no approved plan to execute: understanding is not connected",
        };
      }

      // ── Guard 2: no executor wired — honest default ───────────────────────
      // Actionable but surface-agnostic: the kernel states that execution is a
      // deliberate opt-in and that no executor was provided for THIS decision. It
      // does not name CLI flags or env vars — naming the opt-in mechanism is the
      // job of whichever surface (CLI/server) is consuming the kernel.
      if (executor === null) {
        return {
          status: "unavailable",
          reason:
            "deterministic execution SDK not wired; nothing executed " +
            "(execution is opt-in — no executor was provided for this decision)",
        };
      }

      // ── Guard 3: NO_SILENT_CONTENT_OMISSION ───────────────────────────────
      // Content-claiming create_file with empty body must never reach an
      // actuator (hollow empty blob + false evidence agree). Fail visibly.
      const hollow = hollowContentOmissionReason(
        understanding.value.candidatePlans,
      );
      if (hollow !== null) {
        return { status: "unavailable", reason: hollow };
      }

      // ── Derive approved ops from the ratified understanding ───────────────
      const approvedOps = deriveApprovedOps(understanding.value);

      // ── Guard 4: nothing executable in the approved plan ──────────────────
      // A connected understanding for a non-executable intent (e.g. a
      // destructive rename/delete not in the v1 subset) carries no operation.
      // There is nothing to actuate; claiming execution would be fabrication.
      if (approvedOps.length === 0) {
        return {
          status: "unavailable",
          reason: "approved plan has no executable operation (non-executable intent)",
        };
      }

      // ── Capture the declared observation scope BEFORE actuation ─────────
      // Observer-side read path, invoked here (never inside the executor) so
      // the pre-state of the approved scope is pinned before any mutation can
      // occur. A sensor failure is recorded explicitly; it never blocks the
      // already-approved actuation and never fabricates a snapshot.
      let observationScope: readonly string[] | undefined;
      let scopeSnapshotPre: readonly ScopeSnapshotEntry[] | undefined;
      let observationScopeError: string | undefined;
      if (scopeSensor !== null) {
        try {
          const sensing = await scopeSensor(approvedOps);
          if (sensing !== null) {
            observationScope = sensing.scope;
            scopeSnapshotPre = sensing.snapshot;
          }
        } catch (sensorErr) {
          observationScopeError =
            sensorErr instanceof Error ? sensorErr.message : String(sensorErr);
        }
      }

      // ── Execute ───────────────────────────────────────────────────────────
      // Hand the executor a FROZEN DEEP COPY, never our own references. This
      // closes a certification-bypass: an executor that mutated the approved ops
      // in place and returned the same references would compare equal to itself
      // and falsely certify ranWhatWasApproved=true. Certification compares
      // against `approvedOps` (our untouched snapshot).
      const frozenOps = Object.freeze(
        approvedOps.map((op) => Object.freeze({ ...op })),
      ) as readonly ExecutableOperation[];
      // A_SEND: invoke the observed executor with the frozen copy. A_RECV is
      // the observer wrapper entry (same reference). No sink → no observer
      // (correspondence stays NOT_ESTABLISHED at verification).
      const observed: DeterministicExecutor =
        boundarySink !== null
          ? makeGovernedExecutorBoundaryObserver(executor, boundarySink)
          : executor;
      // Await supports both sync (filesystem) and async (network/REST source-
      // control) actuators; awaiting a sync return value is a no-op.
      const outcome = await observed(frozenOps);

      // ── Certify: ranWhatWasApproved is the structural "only approved" proof ─
      // Compared against `approvedOps` (our own snapshot), so any addition, drop,
      // reorder, field change, or refusal is detected and reported honestly.
      const ranWhatWasApproved = opsEqual(approvedOps, outcome.ranOps);

      return {
        status: "connected",
        value: {
          ranWhatWasApproved,
          deterministic: outcome.deterministic,
          // steps reflect what ACTUALLY ran (faithful to the actuated ops).
          steps: outcome.ranOps.map(opLabel),
          // Per-op transparency: snapshot so the executor cannot mutate post-return.
          results: outcome.results.map((r) => ({ ...r, op: { ...r.op } })),
          // Declared observation scope + pre-actuation snapshot, captured above
          // BEFORE the executor ran (ABSENT when no sensor was wired — gauge law).
          ...(observationScope !== undefined ? { observationScope } : {}),
          ...(scopeSnapshotPre !== undefined ? { scopeSnapshotPre } : {}),
          ...(observationScopeError !== undefined ? { observationScopeError } : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        reason: `execution stage failed unexpectedly: ${message}`,
      };
    }
  };
}

// ─── Reference executor ────────────────────────────────────────────────────────

/**
 * Reference faithful executor: "runs" exactly the approved ops, deterministically.
 *
 * It performs NO real IO — it simply echoes the approved ops back, which is why it
 * can honestly report `deterministic: true`. It is the structural "honest
 * executor" for tests/illustration. A real actuator (see fs-executor.ts) performs
 * filesystem writes and MUST report `deterministic: false`.
 */
export const identityExecutor: DeterministicExecutor = (approvedOps) => ({
  ranOps: approvedOps.map((op) => ({ ...op })),
  results: approvedOps.map((op) => ({
    op: { ...op },
    status: "ran" as const,
    detail: "reference executor (no real IO)",
  })),
  deterministic: true,
});

// ─── Default export (honest: not wired) ───────────────────────────────────────

/**
 * The honest default: no executor wired → section is unavailable.
 *
 * The spine already produces a fully-ratified record when ratification is
 * connected+approved. Execution is separately not actuated until a real
 * `DeterministicExecutor` is injected via `makeExecutionPort(executor)`.
 *
 * This is the correct port to pass when the caller wants to record a ratified
 * decision without yet running an actuator — the record is complete and honest,
 * and the execution section explicitly states nothing was executed.
 */
export const executionPort = makeExecutionPort(null);
