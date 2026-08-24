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
import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
import type { ClaudeAgentPlugin } from "../claude/delivery-gate.js";
import type { FsPlugin } from "../workflow/types.js";
/** Implementation identity carried on every record. */
export declare const BOUNDARY_OBSERVER_IMPLEMENTATION_ID = "BOUNDARY_OBSERVER_V1";
/**
 * Boundary identities. Each names the exact seam observed — distinct seams
 * are never collapsed merely because they share this record schema.
 */
export declare const BOUNDARY: {
    /** deliver() → CursorDeliveryGate → plugin.receive(request) */
    readonly sessionCursorReceive: "session_receive.cursor";
    /** deliverClaude() → ClaudeDeliveryGate → plugin.receive(request) */
    readonly sessionClaudeReceive: "session_receive.claude";
    /** replay --execute: executeOneTask → plugin.executeFsOp(op) */
    readonly replayFsExecuteFsOp: "replay_fs_adapter.executeFsOp";
    /** replay --execute: executeRunCommand(spec, root) — before spawnSync */
    readonly replayRunCommandExecute: "replay_run_command.execute";
    /** replay --execute: executeStructuredReplace(spec, root) — before read/write */
    readonly replayStructuredReplaceExecute: "replay_structured_replace.execute";
    /** governed-decision execution port → DeterministicExecutor(frozenOps) */
    readonly governedDecisionExecutorReceive: "governed_decision.executor_receive";
    /** R6 GPC Hybrid D: callee receive of materializeSandboxFs, before mkdir/write */
    readonly governedDecisionGpcSandboxProjectionReceive: "governed_decision.gpc_sandbox_projection_receive";
};
export type BoundaryId = (typeof BOUNDARY)[keyof typeof BOUNDARY];
/**
 * One boundary observation. `opCanonical`/`observedHash` describe ONLY the
 * object as received at this side of the named boundary — never caller state,
 * never callee self-report.
 */
export type BoundaryObservationRecord = {
    readonly recordType: "boundary_observation.v1";
    /** Which boundary produced this record (see BOUNDARY). */
    readonly boundary: string;
    readonly observerImpl: string;
    /** Module-global monotonic observation order (total order within a process). */
    readonly seq: number;
    readonly observedAtUtc: string;
    /** stableStringify(received) — the object exactly as received. */
    readonly opCanonical: string;
    /** hashObject(received) — SHA-256 over opCanonical. */
    readonly observedHash: string;
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
/**
 * Wrap a Cursor session plugin with boundary observation at the
 * `receive(request)` seam. Satisfies CursorEditorPlugin; the delivery gate
 * cannot distinguish the observer from a bare plugin except by the records
 * appearing in the sink.
 */
export declare function makeCursorBoundaryObserver(inner: CursorEditorPlugin, sink: BoundarySink): CursorEditorPlugin;
/**
 * Wrap a Claude session plugin with boundary observation at the
 * `receive(request)` seam. When the composed plugin is a MultiLlmPlugin,
 * this observes the gate→plugin boundary (the request as the composed
 * receiver got it); per-participant consensus records remain a separate,
 * plugin-internal artifact.
 */
export declare function makeClaudeBoundaryObserver(inner: ClaudeAgentPlugin, sink: BoundarySink): ClaudeAgentPlugin;
/**
 * Wrap an FsPlugin with boundary observation under an explicit replay
 * boundary identity. Used by `replay --execute`, whose adapter is composed
 * inside the kernel replay module — a different composition site than the
 * product CLI/web roots, recorded as such.
 */
export declare function makeReplayFsBoundaryObserver(inner: FsPlugin, sink: BoundarySink): FsPlugin;
/**
 * Observe the argument received by a replay-internal execution function at
 * its entry boundary, before delegation. The wrapper hashes its own received
 * first argument (the task spec — the execution-relevant payload; the
 * workspace root is constructor-equivalent context, flagged not hidden) and
 * forwards the SAME arguments unchanged.
 */
export declare function observeInvocation<A extends readonly unknown[], R>(fn: (...args: A) => R, sink: BoundarySink, boundary: BoundaryId): (...args: A) => R;
/**
 * Observe the governed-decision DeterministicExecutor receiving seam.
 * Hashes the callee-side `frozenOps` argument, awaits sink acknowledgement,
 * then forwards the SAME array reference and returns the inner result
 * unchanged. Sink throw/rejection is logged; execution continues with no
 * admissible record.
 */
export declare function makeGovernedExecutorBoundaryObserver<Ops extends readonly unknown[], Result>(inner: (ops: Ops) => Result | Promise<Result>, sink: BoundarySink): (ops: Ops) => Promise<Result>;
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
export declare function gpcSandboxProjectionReceivePayload(capsule: GpcSandboxProjectionCapsuleFields, sandboxRoot: string, workspaceKey: string): GpcSandboxProjectionReceivePayload;
/**
 * Observe the R6 GPC sandbox-projection receiving seam. Hashes the explicit
 * reconstructible invocation payload, awaits sink acknowledgement, then
 * forwards the SAME capsule / sandboxRoot / workspaceKey references to the
 * inner materializer and returns its result unchanged. Sink throw/rejection
 * is logged; materialization continues with no admissible record.
 */
export declare function makeGovernedGpcSandboxProjectionObserver<C extends GpcSandboxProjectionCapsuleFields, R>(inner: (capsule: C, sandboxRoot: string, workspaceKey: string) => R, sink: BoundarySink): (capsule: C, sandboxRoot: string, workspaceKey: string) => Promise<R>;
/**
 * Append-only JSONL file sink. The file handle is owned by the composition
 * root; the callee never receives a reference to the sink or the records.
 */
export declare function makeBoundaryJsonlSink(filePath: string): BoundarySink;
//# sourceMappingURL=boundary-observer.d.ts.map