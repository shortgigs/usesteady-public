/**
 * Boundary Observer V1 — receiving-side invocation observation for the
 * session seam and the replay execution boundaries
 * (receiving-boundary observer implementation; reclosure pending).
 *
 * Same provenance philosophy as FS_BOUNDARY_OBSERVER_V1
 * (./fs-boundary-observer.ts), mechanically generalized — not a second model:
 *
 *   observedHash = hashObject(received)   — the FIRST meaningful operation
 *
 * computed from the callee-side argument exactly as received, before any
 * callee-controlled interpretation or transformation, then the SAME reference
 * is forwarded and the inner result returned verbatim.
 *
 * Honest naming: the FS adapter seam keeps its pinned
 * `fs_boundary_observation.v1` contract untouched. Records produced here are
 * `boundary_observation.v1` and carry an explicit `boundary` identity — the
 * session seam and the replay-internal execution functions are NOT the FS
 * adapter seam and are never labeled as if they were.
 *
 * Rules (identical discipline to the FS observer):
 *   - Evidence derives only from the callee-side argument. This module has no
 *     access to run state, coordinator state, spec state, or the callee's
 *     result.
 *   - The boundary record is produced before the inner callee is invoked.
 *   - Observe-only: the record never influences the call; sink failure never
 *     blocks execution (the missing record fails closed at verification —
 *     absence means correspondence NOT ESTABLISHED, never inferred).
 *   - Scope: the sink is a process-local append-only file. This component
 *     provides receiving-side observation; it does not isolate evidence
 *     custody from the producing process.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname }                 from "node:path";

import { hashObject, stableStringify } from "../ucp/hashes.js";
import type { CursorEditorPlugin }     from "../cursor/delivery-gate.js";
import type { ClaudeAgentPlugin }      from "../claude/delivery-gate.js";
import type { FsPlugin }               from "../workflow/types.js";

/** Implementation identity carried on every record. */
export const BOUNDARY_OBSERVER_IMPLEMENTATION_ID = "BOUNDARY_OBSERVER_V1";

/**
 * Boundary identities. Each names the exact seam observed — distinct seams
 * are never collapsed merely because they share this record schema.
 */
export const BOUNDARY = {
  /** deliver() → CursorDeliveryGate → plugin.receive(request) */
  sessionCursorReceive:          "session_receive.cursor",
  /** deliverClaude() → ClaudeDeliveryGate → plugin.receive(request) */
  sessionClaudeReceive:          "session_receive.claude",
  /** replay --execute: executeOneTask → plugin.executeFsOp(op) */
  replayFsExecuteFsOp:           "replay_fs_adapter.executeFsOp",
  /** replay --execute: executeRunCommand(spec, root) — before spawnSync */
  replayRunCommandExecute:       "replay_run_command.execute",
  /** replay --execute: executeStructuredReplace(spec, root) — before read/write */
  replayStructuredReplaceExecute: "replay_structured_replace.execute",
  /** governed-decision execution port → DeterministicExecutor(frozenOps) */
  governedDecisionExecutorReceive: "governed_decision.executor_receive",
  /** R6 GPC Hybrid D: callee receive of materializeSandboxFs, before mkdir/write */
  governedDecisionGpcSandboxProjectionReceive:
    "governed_decision.gpc_sandbox_projection_receive",
} as const;

export type BoundaryId = (typeof BOUNDARY)[keyof typeof BOUNDARY];

/**
 * One boundary observation. `opCanonical`/`observedHash` describe ONLY the
 * object as received at this side of the named boundary — never caller state,
 * never callee self-report.
 */
export type BoundaryObservationRecord = {
  readonly recordType:    "boundary_observation.v1";
  /** Which boundary produced this record (see BOUNDARY). */
  readonly boundary:      string;
  readonly observerImpl:  string;
  /** Module-global monotonic observation order (total order within a process). */
  readonly seq:           number;
  readonly observedAtUtc: string;
  /** stableStringify(received) — the object exactly as received. */
  readonly opCanonical:   string;
  /** hashObject(received) — SHA-256 over opCanonical. */
  readonly observedHash:  string;
};

export type BoundarySink = {
  /**
   * Persist one observation. Synchronous JSONL remains valid (`void`).
   * Asynchronous sinks return a Promise that resolves only after the append
   * is acknowledged. Pending, rejected, or unacknowledged writes are not
   * admissible evidence. Observer wrappers await this before the inner call.
   */
  append(record: BoundaryObservationRecord): void | Promise<void>;
};

let processSeq = 0;

function logSinkFailure(boundary: BoundaryId, err: unknown): void {
  // Observe-only: a failed sink write must not block the approved
  // operation. The missing record fails closed at verification
  // (NOT ESTABLISHED), which is where absence is adjudicated.
  // A record object constructed before a failed acknowledgement is
  // not evidence — only a successfully completed append is admissible.
  console.error(
    `[boundary-observer] sink append failed at ${boundary} (record absent → correspondence NOT ESTABLISHED at verification):`,
    err instanceof Error ? err.message : String(err),
  );
}

function buildBoundaryRecord(
  boundary: BoundaryId,
  received: unknown,
): BoundaryObservationRecord {
  const opCanonical = stableStringify(received);
  return {
    recordType:    "boundary_observation.v1",
    boundary,
    observerImpl:  BOUNDARY_OBSERVER_IMPLEMENTATION_ID,
    seq:           processSeq++,
    observedAtUtc: new Date().toISOString(),
    opCanonical,
    observedHash:  hashObject(received),
  };
}

/**
 * FIRST meaningful operation of every observed boundary: hash the received
 * argument and complete/await sink acknowledgement. Sink failure never
 * blocks execution. Fire-and-forget is forbidden — callers must await.
 */
async function appendBoundaryRecord(
  sink:     BoundarySink,
  boundary: BoundaryId,
  received: unknown,
): Promise<void> {
  const record = buildBoundaryRecord(boundary, received);
  try {
    await sink.append(record);
  } catch (err) {
    logSinkFailure(boundary, err);
  }
}

/**
 * Synchronous acknowledgement path for sync replay wrappers. A sync sink
 * completes before return; an async sink's Promise is returned so a caller
 * that can await may do so. observeInvocation keeps its sync return type
 * (existing R7 JSONL is synchronous).
 */
function appendBoundaryRecordMaybeAsync(
  sink:     BoundarySink,
  boundary: BoundaryId,
  received: unknown,
): void | Promise<void> {
  const record = buildBoundaryRecord(boundary, received);
  try {
    const ack = sink.append(record);
    if (ack !== undefined && typeof (ack as Promise<void>).then === "function") {
      return (ack as Promise<void>).catch((err: unknown) => {
        logSinkFailure(boundary, err);
      });
    }
  } catch (err) {
    logSinkFailure(boundary, err);
  }
}

/**
 * Wrap a Cursor session plugin with boundary observation at the
 * `receive(request)` seam. Satisfies CursorEditorPlugin; the delivery gate
 * cannot distinguish the observer from a bare plugin except by the records
 * appearing in the sink.
 */
export function makeCursorBoundaryObserver(
  inner: CursorEditorPlugin,
  sink:  BoundarySink,
): CursorEditorPlugin {
  return {
    async receive(request) {
      await appendBoundaryRecord(sink, BOUNDARY.sessionCursorReceive, request);
      return inner.receive(request);
    },
  };
}

/**
 * Wrap a Claude session plugin with boundary observation at the
 * `receive(request)` seam. When the composed plugin is a MultiLlmPlugin,
 * this observes the gate→plugin boundary (the request as the composed
 * receiver got it); per-participant consensus records remain a separate,
 * plugin-internal artifact.
 */
export function makeClaudeBoundaryObserver(
  inner: ClaudeAgentPlugin,
  sink:  BoundarySink,
): ClaudeAgentPlugin {
  return {
    async receive(request) {
      await appendBoundaryRecord(sink, BOUNDARY.sessionClaudeReceive, request);
      return inner.receive(request);
    },
  };
}

/**
 * Wrap an FsPlugin with boundary observation under an explicit replay
 * boundary identity. Used by `replay --execute`, whose adapter is composed
 * inside the kernel replay module — a different composition site than the
 * product CLI/web roots, recorded as such.
 */
export function makeReplayFsBoundaryObserver(
  inner: FsPlugin,
  sink:  BoundarySink,
): FsPlugin {
  return {
    async executeFsOp(op) {
      await appendBoundaryRecord(sink, BOUNDARY.replayFsExecuteFsOp, op);
      return inner.executeFsOp(op);
    },
  };
}

/**
 * Observe the argument received by a replay-internal execution function at
 * its entry boundary, before delegation. The wrapper hashes its own received
 * first argument (the task spec — the execution-relevant payload; the
 * workspace root is constructor-equivalent context, flagged not hidden) and
 * forwards the SAME arguments unchanged.
 */
export function observeInvocation<A extends readonly unknown[], R>(
  fn:       (...args: A) => R,
  sink:     BoundarySink,
  boundary: BoundaryId,
): (...args: A) => R {
  return (...args: A) => {
    appendBoundaryRecordMaybeAsync(sink, boundary, args[0]);
    return fn(...args);
  };
}

/**
 * Observe the governed-decision DeterministicExecutor receiving seam.
 * Hashes the callee-side `frozenOps` argument, awaits sink acknowledgement,
 * then forwards the SAME array reference and returns the inner result
 * unchanged. Sink throw/rejection is logged; execution continues with no
 * admissible record.
 */
export function makeGovernedExecutorBoundaryObserver<
  Ops extends readonly unknown[],
  Result,
>(
  inner: (ops: Ops) => Result | Promise<Result>,
  sink:  BoundarySink,
): (ops: Ops) => Promise<Result> {
  return async (received) => {
    await appendBoundaryRecord(sink, BOUNDARY.governedDecisionExecutorReceive, received);
    return inner(received);
  };
}

/**
 * Effectful capsule fields plus registry-bound projection context. Raw
 * `sandboxRoot` is not included (INV-WS-1: server-local paths stay off the
 * observation canonical). `sealed_at` is omitted — it does not change what
 * or where is written and is not independently reconstructible.
 */
export type GpcSandboxProjectionReceivePayload = {
  readonly capsule_id: string;
  readonly plan_id: string;
  readonly intent_summary: string;
  readonly artifact_digests: Readonly<Record<string, string>>;
  readonly artifact_bodies: Readonly<Record<string, string>>;
  readonly dirs: readonly string[];
  readonly policy_seals: readonly string[];
  readonly approval_seal: string;
  readonly workspace_key: string;
  readonly sandbox_root_digest: string;
};

export type GpcSandboxProjectionCapsuleFields = {
  readonly capsule_id: string;
  readonly plan_id: string;
  readonly intent_summary: string;
  readonly artifact_digests: Readonly<Record<string, string>>;
  readonly artifact_bodies: Readonly<Record<string, string>>;
  readonly dirs: readonly string[];
  readonly policy_seals: readonly string[];
  readonly approval_seal: string;
};

/**
 * Independently reconstructible identity of a `materializeSandboxFs`
 * invocation. `sandbox_root_digest` binds the WHERE argument without
 * exposing the server-local path.
 */
export function gpcSandboxProjectionReceivePayload(
  capsule: GpcSandboxProjectionCapsuleFields,
  sandboxRoot: string,
  workspaceKey: string,
): GpcSandboxProjectionReceivePayload {
  return {
    capsule_id:          capsule.capsule_id,
    plan_id:             capsule.plan_id,
    intent_summary:      capsule.intent_summary,
    artifact_digests:    capsule.artifact_digests,
    artifact_bodies:     capsule.artifact_bodies,
    dirs:                capsule.dirs,
    policy_seals:        capsule.policy_seals,
    approval_seal:       capsule.approval_seal,
    workspace_key:       workspaceKey,
    sandbox_root_digest: hashObject(sandboxRoot),
  };
}

/**
 * Observe the R6 GPC sandbox-projection receiving seam. Hashes the explicit
 * reconstructible invocation payload, awaits sink acknowledgement, then
 * forwards the SAME capsule / sandboxRoot / workspaceKey references to the
 * inner materializer and returns its result unchanged. Sink throw/rejection
 * is logged; materialization continues with no admissible record.
 */
export function makeGovernedGpcSandboxProjectionObserver<
  C extends GpcSandboxProjectionCapsuleFields,
  R,
>(
  inner: (capsule: C, sandboxRoot: string, workspaceKey: string) => R,
  sink:  BoundarySink,
): (capsule: C, sandboxRoot: string, workspaceKey: string) => Promise<R> {
  return async (capsule, sandboxRoot, workspaceKey) => {
    const received = gpcSandboxProjectionReceivePayload(
      capsule,
      sandboxRoot,
      workspaceKey,
    );
    await appendBoundaryRecord(
      sink,
      BOUNDARY.governedDecisionGpcSandboxProjectionReceive,
      received,
    );
    return inner(capsule, sandboxRoot, workspaceKey);
  };
}

/**
 * Append-only JSONL file sink. The file handle is owned by the composition
 * root; the callee never receives a reference to the sink or the records.
 */
export function makeBoundaryJsonlSink(filePath: string): BoundarySink {
  let prepared = false;
  return {
    append(record) {
      if (!prepared) {
        mkdirSync(dirname(filePath), { recursive: true });
        prepared = true;
      }
      appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
    },
  };
}
