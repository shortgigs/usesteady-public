/**
 * Governed Decision HTTP API — transport-only Portal surface over the kernel.
 *
 * Canonical design: docs/architecture/USESTEADY_GOVERNED_DECISION_SURFACE_V1.md
 * (Phase E3).
 *
 * ── What it is ────────────────────────────────────────────────────────────────
 *
 *   A framework-light request dispatcher (`handleGovernedApi`) plus a thin
 *   app-registration adapter (`registerGovernedRoutes`). The dispatcher is a pure
 *   function — (method, path, body) -> { status, json } — so it is fully testable
 *   without a live server, and the kernel never imports Express.
 *
 *   Endpoints:
 *     POST /api/governed/decisions                    create + store a DRAFT
 *                                                     (optional body `from`: a
 *                                                     prior recordId whose
 *                                                     observation feeds this
 *                                                     draft's basis — the loop)
 *     GET  /api/governed/decisions                    list decision threads
 *     GET  /api/governed/decisions/:id                project one stored record
 *     POST /api/governed/decisions/:threadId/ratify   ratify a thread's draft
 *                                                     (inherits the draft's loop
 *                                                     ref so the final's basis
 *                                                     matches what was reviewed)
 *
 * ── Authority boundary (transport only) ───────────────────────────────────────
 *
 *   This surface PROJECTS records and CAPTURES one decision. It never sets a
 *   DecisionSection status, assembles a decision, computes a fingerprint (it reads
 *   the draft's via ratifiableFingerprint), or decides whether execution runs.
 *   POST /decisions runs the machine's proposal (produceDraft — no authority);
 *   its optional `from` only points at a STORED prior observation that the spine
 *   then gates on `feedsNextCycle` (basis-only, never authority or execution).
 *   POST /ratify passes the human's decision verbatim to produceFinal — the one
 *   authorized write. It imports only runner/store/projection/epistemic/types.
 *
 *   Responses carry STRUCTURED projection + epistemic JSON (not rendered lines);
 *   the Portal UI (E4) renders. Never throws: any unexpected error degrades to a
 *   500 with an error message, mirroring the read path's never-throws discipline.
 *
 * ── INTEGRATION REQUIREMENTS (E4) — do NOT mount publicly without these ────────
 *
 *   This module is transport: it deliberately does not establish WHO is ratifying
 *   or WHICH tenant owns a record. Before exposing it on a network-reachable,
 *   multi-user Portal, the mounting layer MUST provide:
 *     1. Authentication before /ratify (and ideally all routes) — reject anonymous
 *        callers; the ratify write is the product's sole authority signal.
 *     2. Per-REQUEST tenant-scoped storage: resolve `deps.storeDir` (or a scoped
 *        backend) from the authenticated identity on each request. The default
 *        global `~/.usesteady` store is single-tenant/local only.
 *     3. Server-bound approver: pass `deps.approver` from the authenticated
 *        identity. This module IGNORES any client-supplied approver (see below) so
 *        the audit identity cannot be forged from the request body.
 *   Single-ratification (409 on an already-ratified thread) and input size caps
 *   are enforced here; rate limiting belongs to the mounting server.
 */

import { classifyEpistemic } from "./epistemic.js";
import { projectGovernedDecision } from "./projection.js";
import {
  produceDraft,
  produceFinal,
  ratifiableFingerprint,
  candidatePlanFromRecord,
  senseReplacePin,
  replacePinFromRecord,
  senseDeletePin,
  deletePinFromRecord,
  senseRenamePin,
  renamePinFromRecord,
  type HumanRatification,
  type DeterministicExecutor,
  type RealityProbe,
  type BoundarySink,
} from "./runner.js";
import { createGovernedDecisionStore, type StoredRecord } from "./store.js";
import { PERSONA_APPROVER_PREFIX } from "./types.js";
import type { CursorOCDPolicy } from "../cursor/types.js";
import type {
  DecisionSection,
  GovernedDecisionRecord,
  HumanIntent,
  ObservationPayload,
  RatificationDecision,
} from "./types.js";

// ─── Wire types ───────────────────────────────────────────────────────────────

export type GovernedApiRequest = {
  readonly method: string;
  /** Path AFTER the /api/governed prefix, e.g. "/decisions" or "/decisions/<id>". */
  readonly path: string;
  readonly body?: unknown;
};

export type GovernedApiResponse = {
  readonly status: number;
  readonly json: unknown;
};

export type GovernedApiDeps = {
  /** Store directory override; defaults to ~/.usesteady/governed-decisions. */
  readonly storeDir?: string;
  /**
   * Server-bound approver identity for ratification. The mounting layer sets this
   * from the AUTHENTICATED identity. The request body's approver (if any) is
   * ignored — audit identity must never be forgeable from untrusted input.
   * Defaults to "portal" when not supplied (single-user/local use).
   */
  readonly approver?: string;
  /**
   * OPTIONAL server-bound actuator. When present (the mounting layer constructs
   * it ONLY when the operator explicitly enabled execution, e.g. via
   * GOVERNED_EXECUTE=1 + GOVERNED_WORKSPACE), an approved ratification actuates
   * the approved ops through it. Never built from request input — execution is an
   * operator/server decision, never a client-forgeable one. Absent → execution
   * stays honestly `unavailable`.
   */
  readonly executor?: DeterministicExecutor;
  /**
   * OPTIONAL server-bound INDEPENDENT reality probe, paired with the executor's
   * workspace by the mounting layer (GOVERNED_EXECUTE=1 + GOVERNED_WORKSPACE).
   * When present, observation independently verifies the actuated ops against the
   * real filesystem (reality's final veto). Never built from request input.
   * Absent → `realityVerdict` stays honestly `unknown`.
   */
  readonly realityProbe?: RealityProbe;
  /**
   * OPTIONAL server-bound workspace root for the evidence pre-state sensor
   * (L3.S1) — normally the SAME root the executor/probe are bound to
   * (GOVERNED_WORKSPACE), set by the mounting layer. Never read from request
   * input. Absent → the default port senses the server process's cwd (the
   * resolved root is recorded verbatim in the evidence value either way).
   */
  readonly basisWorkspace?: string;
  /**
   * OPTIONAL server-bound OCD policy for the basis policy sensor (L3.S2) —
   * the SAME policy the mounting surface enforces. Never read from request
   * input. Absent → the policy sub-section stays honestly unavailable.
   */
  readonly basisPolicy?: CursorOCDPolicy;
  /**
   * OPTIONAL prebuilt source-of-record for Decision Basis (Portal handoff CERT).
   * Mounting layer (scm-github) may supply a GitHub API HEAD fact when there is
   * no local git checkout. Never read from request input. Absent → git sensor
   * at basisWorkspace / cwd.
   */
  readonly basisSourceOfRecord?: DecisionSection<unknown>;
  /**
   * OPTIONAL best-effort sink for a FINAL record, fired AFTER it is durably
   * persisted (the Decision Record Bridge to the Portal). It carries ZERO
   * authority and runs as a detached side-channel: it is invoked fire-and-forget,
   * any rejection is swallowed, and it can never change the ratification response
   * or block it. The mounting layer wires this ONLY when the operator opted into
   * Portal emission. Absent → nothing is emitted.
   */
  readonly reporter?: (record: GovernedDecisionRecord) => void | Promise<void>;
  /**
   * OPTIONAL best-effort sink for a DRAFT record, fired AFTER it is durably
   * persisted and therefore structurally BEFORE any ratification decision
   * exists (P.S1 - the Candidate Plan Bridge, INV-PS1-1). Identical posture to
   * `reporter`: ZERO authority, fire-and-forget, rejections swallowed; it can
   * never change or block the draft response, and nothing downstream reads it
   * (INV-PS1-2). The mounting layer wires this ONLY when the operator opted
   * into Portal candidate-plan emission. Absent → nothing is emitted.
   */
  readonly draftReporter?: (record: GovernedDecisionRecord) => void | Promise<void>;
  /**
   * OPTIONAL best-effort sink for the Router's DELIVERY moment (D.S1 - the
   * Router Delivery Bridge, INV-DS1-1): fired exactly when the spine hands the
   * approved ops to the server-bound executor, via a transparent per-request
   * executor wrapper. Because it fires ON INVOCATION, a rejected decision, an
   * executor-less mount, or a non-executable intent never emits - the spine's
   * own fail-closed gate is the trigger, not a re-check here. Identical posture
   * to the other reporters: ZERO authority, fire-and-forget, rejections
   * swallowed; it can never change or block the ratification response, and it
   * carries a delivery FACT only - never a result, never a verification input
   * (INV-WL-1). It receives the reviewed DRAFT record (for provenance linkage
   * only - the bridge's payload builder structurally accepts nothing beyond
   * run id, executor kind, delivered-at) plus the observed handoff moment.
   * The mounting layer wires this ONLY when the operator opted into Portal
   * router-delivery emission. Absent → nothing is emitted.
   */
  readonly deliveryReporter?: (
    record: GovernedDecisionRecord,
    handoff: { readonly deliveredAt: string; readonly executorKind?: string },
  ) => void | Promise<void>;
  /** Per-request executor label for router-delivery emission (workspace SCM vs fs). */
  readonly deliveryExecutorKind?: string;
  /**
   * OPTIONAL portal-supplied ucp_root_id for handoff drafts (persisted on the
   * store envelope only — never part of the content hash). Bridge emissions
   * prefer this over re-deriving from the composed handoff goal.
   */
  readonly portalUcpRootId?: string | null;
  /**
   * OPTIONAL build-lane permission for the synthetic (persona) ratifier seat
   * (S1 — SYNTHETIC_OPERATOR_LANE_V1, INV-SO-3). Set by the mounting layer from
   * the SERVER environment only (GOVERNED_SYNTHETIC_RATIFIER=1), never from
   * request input. When absent/false — the production posture — a server-bound
   * approver inside the `persona:` namespace BLOCKS every ratification on this
   * surface with 403 (fail-closed; not degraded, not warned).
   */
  readonly allowSyntheticRatifier?: boolean;
  /**
   * OPTIONAL server-bound receiving-boundary sink. Wired by the composition
   * root (never from request input). When present with an executor, the
   * execution port records the frozen ops at the executor receive seam
   * before actuation. The same sink is the R6 GPC sandbox-projection
   * receive sink when that effect is reachable (including when execution
   * is disabled). Absent → no admissible receiving record.
   */
  readonly boundarySink?: BoundarySink;
};

// Input bounds — cheap DoS / abuse mitigation on the create path.
const MAX_GOAL_LEN = 2000;
const MAX_CONSTRAINTS = 64;
const MAX_CONSTRAINT_LEN = 1000;
// A recordId is a 64-char SHA-256 hex; cap defensively well above that. The value
// is only ever used as an equality key into the store — never a filesystem path.
const MAX_FROM_LEN = 256;

// ─── Payload shaping (structured, not rendered) ───────────────────────────────

function recordPayload(record: GovernedDecisionRecord) {
  return {
    projection: projectGovernedDecision(record),
    epistemic: classifyEpistemic(record),
  };
}

function storedPayload(stored: StoredRecord) {
  return { envelope: stored.envelope, ...recordPayload(stored.record) };
}

// ─── Body validation (defensive — request bodies are untrusted) ───────────────

function readGoal(body: unknown): { goal: string; constraints: readonly string[] } | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as { goal?: unknown; constraints?: unknown };
  if (typeof b.goal !== "string" || b.goal.trim().length === 0) return null;
  if (b.goal.length > MAX_GOAL_LEN) return null;
  const constraints = Array.isArray(b.constraints)
    ? b.constraints.filter((c): c is string => typeof c === "string" && c.length <= MAX_CONSTRAINT_LEN)
    : [];
  if (constraints.length > MAX_CONSTRAINTS) return null;
  return { goal: b.goal, constraints };
}

/**
 * Read the OPTIONAL automatic-loop reference (`from`) from the (untrusted) body:
 * the recordId of a prior decision whose observation should feed THIS cycle's
 * Decision Basis. Returns the trimmed string, or `null` when absent. Returns the
 * sentinel `"__invalid__"` only for a present-but-malformed value so the caller
 * can 400 it (rather than silently ignoring a typo'd reference).
 *
 * The value is only ever an equality key into the store (never a filesystem
 * path), and the spine re-checks `feedsNextCycle` eligibility regardless.
 */
function readFrom(body: unknown): string | null | "__invalid__" {
  if (body === null || typeof body !== "object") return null;
  const b = body as { from?: unknown };
  if (b.from === undefined || b.from === null) return null;
  if (typeof b.from !== "string") return "__invalid__";
  const trimmed = b.from.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FROM_LEN) return "__invalid__";
  return trimmed;
}

/**
 * Resolve a prior decision's observation from the SHARED store for the automatic
 * loop. The observation bytes always come from the store (never the request),
 * and the spine alone gates eligibility (`feedsNextCycle`). Returns `{ missing }`
 * when the referenced record does not exist; the caller maps that to the status
 * appropriate for its context (404 on create, 422 on ratify).
 */
function resolvePriorObservationFromStore(
  store: ReturnType<typeof createGovernedDecisionStore>,
  ref: string,
):
  | { priorObservation: ObservationPayload | null; priorObservationRef: string }
  | { missing: true } {
  const prior = store.getRecord(ref);
  if (prior === null) return { missing: true };
  const obs = prior.record.observation;
  return {
    priorObservation: obs.status === "unavailable" ? null : obs.value,
    priorObservationRef: ref,
  };
}

/**
 * Validate ONLY the decision from the (untrusted) body. The approver is NOT read
 * from the body — it is server-bound via deps.approver — so the audit identity
 * cannot be forged.
 */
function readDecision(body: unknown): { decision: RatificationDecision } | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as { decision?: unknown };
  if (b.decision !== "approved" && b.decision !== "rejected") return null;
  return { decision: b.decision };
}

// ─── Path parsing ─────────────────────────────────────────────────────────────

function pathSegments(path: string): readonly string[] {
  return path.split("/").map((s) => s.trim()).filter((s) => s.length > 0);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function createDraft(
  store: ReturnType<typeof createGovernedDecisionStore>,
  body: unknown,
  basisWorkspace: string | null,
  basisPolicy: CursorOCDPolicy | null,
  draftReporter: ((record: GovernedDecisionRecord) => void | Promise<void>) | null,
  portalUcpRootId?: string | null,
  basisSourceOfRecord: DecisionSection<unknown> | null = null,
): Promise<GovernedApiResponse> {
  const intentInput = readGoal(body);
  if (intentInput === null) {
    return { status: 400, json: { error: "body must include a non-empty 'goal' string" } };
  }
  const intent: HumanIntent = { goal: intentInput.goal, constraints: intentInput.constraints };

  // OPTIONAL automatic-loop ingress: feed a prior decision's observation into
  // THIS draft's Decision Basis. The observation is sourced from the store (never
  // the request body), and the spine gates eligibility (feedsNextCycle). This is
  // the Portal's equivalent of the CLI `decide --from`.
  const from = readFrom(body);
  if (from === "__invalid__") {
    return { status: 400, json: { error: "'from' must be a non-empty recordId string" } };
  }
  let loop: { priorObservation?: ObservationPayload | null; priorObservationRef?: string } = {};
  if (from !== null) {
    const resolved = resolvePriorObservationFromStore(store, from);
    if ("missing" in resolved) {
      return { status: 404, json: { error: `no record with recordId ${from} to feed from` } };
    }
    loop = {
      priorObservation: resolved.priorObservation,
      priorObservationRef: resolved.priorObservationRef,
    };
  }

  // Evidence pre-state (L3.S1): sensed against the server-bound workspace (the
  // same root the executor would actuate) — never a client-supplied path.
  // Replace pin (L4.S1) + delete pin (A1) + rename pin (R1): sensed against
  // the SAME server-bound root so a replace/delete/rename goal's op is
  // anchored to the file content that exists now — the content the reviewer
  // will see in the draft. Never a client-supplied path.
  const replacePin = senseReplacePin(basisWorkspace ?? process.cwd(), intent.goal);
  const deletePin = senseDeletePin(basisWorkspace ?? process.cwd(), intent.goal);
  const renamePin = senseRenamePin(basisWorkspace ?? process.cwd(), intent.goal);
  const draft = await produceDraft(
    intent,
    loop.priorObservationRef !== undefined
      ? { ...(loop.priorObservation !== undefined ? { priorObservation: loop.priorObservation } : {}), priorObservationRef: loop.priorObservationRef }
      : {},
    {
      basisWorkspace,
      basisPolicy,
      replacePin,
      deletePin,
      renamePin,
      basisSourceOfRecord,
    },
  );
  const stored = store.appendDraft(
    draft,
    typeof portalUcpRootId === "string" && portalUcpRootId.trim().length > 0
      ? { portalUcpRootId: portalUcpRootId.trim() }
      : undefined,
  );

  // P.S1: best-effort Portal emission AFTER durable persistence of the DRAFT -
  // structurally before any ratification decision exists (INV-PS1-1). Fire-and-
  // forget: a detached, swallowed side-channel that carries no authority and
  // never blocks or alters this response (INV-PS1-2). Only the persisted draft
  // is ever emitted.
  if (draftReporter !== null) {
    void Promise.resolve()
      .then(() => draftReporter(stored.record))
      .catch(() => {
        /* side-channel: a reporting failure must never affect the draft */
      });
  }

  return { status: 201, json: storedPayload(stored) };
}

async function ratifyThread(
  store: ReturnType<typeof createGovernedDecisionStore>,
  threadId: string,
  body: unknown,
  approver: string,
  executor: DeterministicExecutor | null,
  realityProbe: RealityProbe | null,
  reporter: ((record: GovernedDecisionRecord) => void | Promise<void>) | null,
  deliveryReporter:
    | ((
        record: GovernedDecisionRecord,
        handoff: { readonly deliveredAt: string; readonly executorKind?: string },
      ) => void | Promise<void>)
    | null,
  basisWorkspace: string | null,
  basisPolicy: CursorOCDPolicy | null,
  allowSyntheticRatifier: boolean,
  deliveryExecutorKind: string | null = null,
  basisSourceOfRecord: DecisionSection<unknown> | null = null,
  boundarySink: BoundarySink | null = null,
): Promise<GovernedApiResponse> {
  const decisionInput = readDecision(body);
  if (decisionInput === null) {
    return {
      status: 400,
      json: { error: "body must include 'decision' of 'approved' or 'rejected'" },
    };
  }

  // S1 / INV-SO-3: production fails closed. The approver is server-bound; if the
  // mounting layer seated a persona (approver in the reserved `persona:`
  // namespace) while this surface does not permit synthetic ratifiers, the
  // decision is BLOCKED — never degraded to human, never warned through.
  const personaSeat = approver.startsWith(PERSONA_APPROVER_PREFIX);
  if (personaSeat && !allowSyntheticRatifier) {
    return {
      status: 403,
      json: {
        error:
          "persona ratifier is blocked on this surface (INV-SO-3): synthetic seats require GOVERNED_SYNTHETIC_RATIFIER=1 in the server environment (build lanes only)",
      },
    };
  }

  const all = store.readAll();

  // Find the thread's DRAFT (the reviewed proposal). Read-only lookup.
  const draftStored = all.find(
    (s) => s.envelope.threadId === threadId && s.envelope.kind === "draft",
  );
  if (draftStored === undefined) {
    return { status: 404, json: { error: `no draft found for thread ${threadId}` } };
  }

  // Single-ratification policy, enforced by two layers:
  //   1. DURABLE source of truth — an existing stored final. This is self-healing:
  //      it does not depend on any marker surviving, so it catches every COMPLETED
  //      ratification (and any pre-marker / cleaned-marker data).
  const existingFinal = all.find(
    (s) => s.envelope.threadId === threadId && s.envelope.kind === "final",
  );
  if (existingFinal !== undefined) {
    return { status: 409, json: { error: `thread ${threadId} is already ratified` } };
  }
  //   2. TRANSIENT in-flight guard — an atomic claim closing the check-then-act
  //      race so two concurrent ratify calls cannot both produce a final and flip
  //      the decision during the produce+append window. Released in `finally`, so
  //      a normal failure self-recovers (a retry is possible). A hard process
  //      crash in the microsecond window between claim and append can orphan the
  //      marker; the E4 persistent DB backend (real transactions) is the proper
  //      substrate for that edge — documented in the header.
  if (!store.tryClaimRatification(threadId)) {
    return { status: 409, json: { error: `thread ${threadId} is being ratified` } };
  }

  try {
    // AUTHORITATIVE re-check UNDER the lock: the pre-claim read above is a stale
    // snapshot. Another ratify could have appended a final and released the claim
    // between that read and our winning the claim. The winner always appends
    // before releasing (append in try, release in finally), so once we hold the
    // lock a durable final here means this thread is already decided.
    const finalNow = store
      .readAll()
      .find((s) => s.envelope.threadId === threadId && s.envelope.kind === "final");
    if (finalNow !== undefined) {
      return { status: 409, json: { error: `thread ${threadId} is already ratified` } };
    }

    // Reconstruct the intent from the draft's OWN humanIntent — never invented.
    const hi = draftStored.record.humanIntent as { goal?: unknown; constraints?: unknown } | undefined;
    const goal = hi !== undefined && typeof hi.goal === "string" ? hi.goal : null;
    if (goal === null) {
      return { status: 422, json: { error: "stored draft has no readable goal" } };
    }
    const constraints = Array.isArray(hi?.constraints)
      ? hi.constraints.filter((c): c is string => typeof c === "string")
      : [];
    const intent: HumanIntent = { goal, constraints };

    const fingerprint = ratifiableFingerprint(draftStored.record);
    if (fingerprint === null) {
      return { status: 422, json: { error: "draft has no stamped fingerprint — cannot ratify" } };
    }

    // Seat the decision with typed provenance (INV-SO-2): a persona-namespaced
    // server-bound approver is recorded as a persona seat (only reachable when
    // the surface permits synthetic ratifiers — checked above); everything else
    // is the human seat. The kernel port independently re-enforces namespace /
    // kind agreement, so no construction path can cast one into the other.
    const humanDecision: HumanRatification = {
      decision: decisionInput.decision,
      approver,
      approverKind: personaSeat ? "persona" : "human",
      ratifiedFingerprint: fingerprint,
    };

    // Inherit the automatic-loop input from the reviewed draft so the final's
    // Decision Basis reproduces EXACTLY what the operator reviewed — on this
    // surface too. The store is shared with the CLI, so a draft loop-fed via
    // `decide --from` can be ratified here; dropping the input would silently
    // diverge the final's basis from the reviewed draft. The draft persisted
    // priorObservationRef IFF a prior observation was eligible and fed its basis.
    // (Inheritance only: ratify NEVER reads a `from` from its own body — the loop
    // is fixed at draft time. Create has a `from` ingress; ratify does not, so a
    // ratify-time swap of the reviewed basis is impossible.) undefined/empty
    // (legacy record) = no loop.
    let priorObservation: ObservationPayload | null = null;
    let priorObservationRef: string | null = null;
    const rawRef = draftStored.record.priorObservationRef;
    if (typeof rawRef === "string" && rawRef.length > 0) {
      const resolved = resolvePriorObservationFromStore(store, rawRef);
      if ("missing" in resolved) {
        return {
          status: 422,
          json: { error: `cannot reproduce the reviewed basis: prior record ${rawRef} is unavailable` },
        };
      }
      priorObservation = resolved.priorObservation;
      priorObservationRef = resolved.priorObservationRef;
    }

    // The executor (if server-enabled) actuates only after the spine's
    // fail-closed gate confirms approval; a rejected decision never executes.
    //
    // Ordering note (durability edge): actuation happens INSIDE produceFinal
    // because the execution result is part of the record being persisted — the
    // action cannot be recorded before it occurs. If appendFinal then throws, the
    // approved ops have already actuated but the audit record did not persist; the
    // dispatcher's catch returns 500 and the failure is logged. This is the same
    // narrow durability edge as the ratification marker (see header); the
    // persistent DB backend is the proper transactional substrate.
    // AI_SEAMS_V1 seam 2: reproduce the reviewed candidate plan (when the draft
    // carries a phrase-representable one — e.g. a CLI plan-draft ratified here
    // via the shared store) so the final's stamped fingerprint matches exactly
    // what was reviewed. Deterministic reconstruction; ignored by the
    // understanding port for parser-parseable goals.
    const inheritedPlan = candidatePlanFromRecord(draftStored.record);
    // Replace pin (L4.S1) + delete pin (A1): reconstructed VERBATIM from the
    // reviewed draft — never re-sensed — so the final anchors to exactly the
    // pinned op the human reviewed; a file changed under the approval is
    // refused by the executor's hash gate.
    const inheritedPin = replacePinFromRecord(draftStored.record);
    const inheritedDeletePin = deletePinFromRecord(draftStored.record);
    const inheritedRenamePin = renamePinFromRecord(draftStored.record);

    // D.S1: the Router's delivery moment, observed at the seam the mounting
    // layer already owns. The wrapper is TRANSPARENT - same ops in, same
    // outcome out, the spine's certification is untouched - and fires the
    // fire-and-forget delivery fact exactly when the spine invokes the
    // executor with the approved ops (INV-DS1-1). The spine's fail-closed
    // gate is the trigger: a rejected decision or a non-executable intent
    // never invokes the executor, so it never emits. A throwing reporter is
    // swallowed and can never affect the actuation or the response (INV-DS1-2).
    const deliveryObservedExecutor: DeterministicExecutor | null =
      executor !== null && deliveryReporter !== null
        ? (approvedOps) => {
            const handoff = {
              deliveredAt: new Date().toISOString(),
              ...(deliveryExecutorKind !== null && deliveryExecutorKind.length > 0
                ? { executorKind: deliveryExecutorKind }
                : {}),
            };
            void Promise.resolve()
              .then(() => deliveryReporter(draftStored.record, handoff))
              .catch(() => {
                /* side-channel: a reporting failure must never affect execution */
              });
            return executor(approvedOps);
          }
        : executor;

    const final = await produceFinal(intent, humanDecision, {
      ...(deliveryObservedExecutor !== null ? { executor: deliveryObservedExecutor } : {}),
      ...(realityProbe !== null ? { realityProbe } : {}),
      ...(priorObservationRef !== null ? { priorObservation, priorObservationRef } : {}),
      ...(inheritedPlan !== null ? { candidatePlan: inheritedPlan } : {}),
      ...(inheritedPin !== null ? { replacePin: inheritedPin } : {}),
      ...(inheritedDeletePin !== null ? { deletePin: inheritedDeletePin } : {}),
      ...(inheritedRenamePin !== null ? { renamePin: inheritedRenamePin } : {}),
      // Evidence pre-state (L3.S1): re-sensed at ratify time against the
      // server-bound workspace; the basis stage runs before execution, so this
      // is the reality that existed at the moment of ratification. The OCD
      // policy sensor (L3.S2) re-reads the same server-bound policy.
      // SoR: prebuilt (scm API HEAD) when supplied; else git at basisWorkspace.
      basisWorkspace,
      basisPolicy,
      basisSourceOfRecord,
      ...(boundarySink !== null ? { boundarySink } : {}),
    });
    let storedFinal: StoredRecord;
    try {
      storedFinal = store.appendFinal(
        final,
        draftStored.envelope.threadId,
        draftStored.record.recordId,
      );
    } catch (persistErr) {
      // Actuation (if any) already happened inside produceFinal. Do not return a
      // bare 500: surface WHAT was actuated so the client is never blind to an
      // approved action whose audit record failed to persist. The executor is
      // idempotent, so a retry is safe.
      const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
      const actuation =
        final.execution.status === "connected" ? (final.execution.value.results ?? null) : null;
      return {
        status: 500,
        json: {
          error: `decision finalized but the audit record failed to persist: ${message}`,
          actuation,
        },
      };
    }

    // Best-effort Portal emission AFTER durable persistence. Fire-and-forget: a
    // detached, swallowed side-channel that carries no authority and never blocks
    // or alters this response. Only the persisted final is ever emitted.
    if (reporter !== null) {
      void Promise.resolve()
        .then(() => reporter(storedFinal.record))
        .catch(() => {
          /* side-channel: a reporting failure must never affect ratification */
        });
    }

    return { status: 200, json: storedPayload(storedFinal) };
  } finally {
    // The DURABLE guard is the stored final; the marker is only a transient
    // in-flight lock, so release it on every outcome (success or failure).
    store.releaseRatificationClaim(threadId);
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Pure request dispatcher. Returns { status, json }; never throws.
 */
export async function handleGovernedApi(
  req: GovernedApiRequest,
  deps: GovernedApiDeps = {},
): Promise<GovernedApiResponse> {
  try {
    const method = req.method.toUpperCase();
    const seg = pathSegments(req.path);
    const store = createGovernedDecisionStore(deps.storeDir);

    // /decisions
    if (seg.length === 1 && seg[0] === "decisions") {
      if (method === "GET") {
        return { status: 200, json: { threads: store.listThreads() } };
      }
      if (method === "POST") {
        return await createDraft(
          store,
          req.body,
          deps.basisWorkspace ?? null,
          deps.basisPolicy ?? null,
          deps.draftReporter ?? null,
          deps.portalUcpRootId,
          deps.basisSourceOfRecord ?? null,
        );
      }
      return { status: 405, json: { error: "method not allowed" } };
    }

    // /decisions/:id  and  /decisions/:threadId/ratify
    if (seg.length === 2 && seg[0] === "decisions") {
      const id = seg[1] as string;
      if (method === "GET") {
        const stored = store.getRecord(id);
        if (stored === null) {
          return { status: 404, json: { error: `no record with recordId ${id}` } };
        }
        return { status: 200, json: storedPayload(stored) };
      }
      return { status: 405, json: { error: "method not allowed" } };
    }

    if (seg.length === 3 && seg[0] === "decisions" && seg[2] === "ratify") {
      const threadId = seg[1] as string;
      if (method === "POST") {
        return await ratifyThread(
          store,
          threadId,
          req.body,
          deps.approver ?? "portal",
          deps.executor ?? null,
          deps.realityProbe ?? null,
          deps.reporter ?? null,
          deps.deliveryReporter ?? null,
          deps.basisWorkspace ?? null,
          deps.basisPolicy ?? null,
          deps.allowSyntheticRatifier === true,
          deps.deliveryExecutorKind ?? null,
          deps.basisSourceOfRecord ?? null,
          deps.boundarySink ?? null,
        );
      }
      return { status: 405, json: { error: "method not allowed" } };
    }

    return { status: 404, json: { error: "not found" } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, json: { error: message } };
  }
}

// ─── Express-shaped registration adapter (no Express import) ───────────────────

/** Minimal structural shape of the bits of an Express app we use. */
export type GovernedHttpApp = {
  get(path: string, handler: (req: ExpressLikeReq, res: ExpressLikeRes) => void): unknown;
  post(path: string, handler: (req: ExpressLikeReq, res: ExpressLikeRes) => void): unknown;
};
type ExpressLikeReq = { params: Record<string, string>; body?: unknown };
type ExpressLikeRes = { status(code: number): ExpressLikeRes; json(value: unknown): unknown };

/**
 * Register the four governed-decision routes on an Express-like app. Pure
 * transport: every handler simply forwards to `handleGovernedApi` and writes the
 * returned { status, json }. No authority lives here.
 */
export function registerGovernedRoutes(app: GovernedHttpApp, deps: GovernedApiDeps = {}): void {
  const send = async (res: ExpressLikeRes, req: GovernedApiRequest): Promise<void> => {
    const { status, json } = await handleGovernedApi(req, deps);
    res.status(status).json(json);
  };

  app.post("/api/governed/decisions", (req, res) => {
    void send(res, { method: "POST", path: "/decisions", body: req.body });
  });
  app.get("/api/governed/decisions", (_req, res) => {
    void send(res, { method: "GET", path: "/decisions" });
  });
  app.get("/api/governed/decisions/:id", (req, res) => {
    const id = req.params["id"] ?? "";
    // Guard an empty param: forwarding "/decisions/" would collapse to the list
    // route and return the wrong shape (200 list instead of 404 single-record).
    if (id.trim().length === 0) {
      res.status(404).json({ error: "no record id" });
      return;
    }
    void send(res, { method: "GET", path: `/decisions/${id}` });
  });
  app.post("/api/governed/decisions/:threadId/ratify", (req, res) => {
    const threadId = req.params["threadId"] ?? "";
    if (threadId.trim().length === 0) {
      res.status(404).json({ error: "no thread id" });
      return;
    }
    void send(res, {
      method: "POST",
      path: `/decisions/${threadId}/ratify`,
      body: req.body,
    });
  });
}
