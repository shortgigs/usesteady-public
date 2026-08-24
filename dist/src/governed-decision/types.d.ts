/**
 * Canonical record for the UseSteady constitutional execution kernel.
 *
 * See docs/architecture/USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md (FROZEN v1).
 *
 * One governed decision accretes exactly one typed, gauge-tagged section per
 * pipeline stage. No stage invents a private object that dies in memory: every
 * stage appends to THIS record, and the projection layer reads only this record.
 *
 * Gauge law (encoded in the type system): a section is `connected` (wired to a
 * real runtime source), `derived` (explicitly computed from connected sections),
 * or `unavailable` (no sensor yet — stated honestly). There is no fourth state;
 * "invented" is unrepresentable.
 */
import type { AuthorityLevel } from "../../core/k1/types.js";
export type SectionStatus = "connected" | "derived" | "unavailable";
export type StageName = "understanding" | "constitution" | "decisionBasis" | "truthArbitration" | "ratification" | "execution" | "observation";
/** The canonical stage order. The spine MUST run stages in exactly this order. */
export declare const STAGE_ORDER: readonly StageName[];
/**
 * A gauge-tagged section. A value exists only when status is `connected` or
 * `derived`; an `unavailable` section carries a reason and never a value.
 */
export type DecisionSection<T> = {
    readonly status: "connected";
    readonly value: T;
} | {
    readonly status: "derived";
    readonly value: T;
    readonly derivedFrom: readonly StageName[];
} | {
    readonly status: "unavailable";
    readonly reason: string;
};
/**
 * A structured, executable operation bound to a candidate plan.
 *
 * This is the kernel-local mirror of the NON-DESTRUCTIVE subset of the
 * deterministic parser's `ParsedIntent`. It is what makes "the SDK executes only
 * what was approved" actionable: the operation is part of the understanding
 * section, which the constitution fingerprints and the human ratifies — so the
 * exact op is anchored to the ratified decision.
 *
 * v1 covered only non-destructive operations (create_dir/create_file). L4.S1
 * adds `replace_in_file` — the first CONTENT-MODIFYING op — under destructive-op
 * scrutiny: the op carries the sha256 of the file content the pin sensor read
 * at draft time (`expectedPriorSha256`, the pre-state the human's approval is
 * anchored to) and the sha256 of the deterministically-derived post-content
 * (`expectedPostSha256`, what the independent reality probe verifies
 * byte-exactly). The executor refuses to modify a file whose current content
 * hash matches neither — reality changed since approval, so the approval no
 * longer describes it. Both hashes are INJECTED data (sensed by
 * stages/replace-pin.ts and threaded by the surface), never computed inside
 * the pure understanding port.
 *
 * A1 adds `delete_file` and R1 adds `rename_file`, both under the same pinned
 * pre-state discipline: the op carries the sha256 of the content the pin
 * sensor read at draft time, and the executor refuses when reality no longer
 * matches what the human approved.
 */
export type ExecutableOperation = {
    readonly kind: "create_dir";
    readonly path: string;
} | {
    readonly kind: "create_file";
    readonly path: string;
    readonly content: string;
} | {
    readonly kind: "replace_in_file";
    readonly path: string;
    /** The exact text to replace (every occurrence), verbatim from the parsed intent. */
    readonly find: string;
    /** The replacement text, verbatim from the parsed intent. */
    readonly replaceWith: string;
    /**
     * sha256 (hex) of the file content the pin sensor read at draft time —
     * the pre-state the human's approval is anchored to. The executor
     * refuses if the file no longer hashes to this (or to the post hash,
     * the idempotent-satisfied case).
     */
    readonly expectedPriorSha256: string;
    /**
     * sha256 (hex) of the deterministically-derived post-content
     * (pinned prior content with every `find` occurrence replaced).
     * The independent reality probe verifies the on-disk file against this,
     * byte-exactly. Also the executor's idempotency anchor on retry.
     */
    readonly expectedPostSha256: string;
} | {
    readonly kind: "delete_file";
    readonly path: string;
    /**
     * sha256 (hex) of the file content the delete-pin sensor read at draft
     * time — the pre-state the human's approval is anchored to (A1). The
     * executor refuses to unlink a file that no longer hashes to this:
     * deleting content the human never saw would detach the approval from
     * reality. An already-absent target is the satisfied post-condition
     * (idempotent success on retry).
     */
    readonly expectedPriorSha256: string;
} | {
    readonly kind: "rename_file";
    /**
     * The SOURCE path, verbatim from the parsed intent. It occupies the
     * union's common `path` field so every path-keyed consumer (policy
     * sensor, evidence sensor, structural equality) sees the file whose
     * content the approval is anchored to. The destination is `toPath`;
     * consumers that must evaluate the write target (OCD policy) handle
     * `rename_file` explicitly.
     */
    readonly path: string;
    /** The destination path, verbatim from the parsed intent. */
    readonly toPath: string;
    /**
     * sha256 (hex) of the SOURCE file content the rename-pin sensor read at
     * draft time — the pre-state the human's approval is anchored to (R1).
     * The executor refuses to rename a file that no longer hashes to this:
     * moving content the human never saw would detach the approval from
     * reality. Source absent + destination present hashing to this pin is
     * the satisfied post-condition (idempotent success on retry).
     */
    readonly expectedPriorSha256: string;
} | {
    /**
     * W-E5 / B.S3 — human attestation of an approved Candidate Plan task.
     * No filesystem mutation. `path` is a stable attestation id (e.g.
     * `attest/step-1`); `statement` is the human-reviewed task summary.
     */
    readonly kind: "human_attest";
    readonly path: string;
    readonly statement: string;
    readonly executorClass: "human";
} | {
    /**
     * W-E6 / B.S4 — record an approved document-class Candidate Plan task.
     * No filesystem/SCM mutation. `path` is a stable document id (e.g.
     * `document/step-1`); `statement` is the human-reviewed task summary.
     */
    readonly kind: "document_record";
    readonly path: string;
    readonly statement: string;
    readonly executorClass: "document";
};
export type CandidatePlan = {
    readonly id: string;
    readonly summary: string;
    /**
     * The structured operation this plan would execute, when the deterministic
     * parser produced one in the executable subset. ABSENT (not null, not a
     * fabricated default) when there is no executable operation — gauge law: a
     * value is present only when it is real.
     */
    readonly operation?: ExecutableOperation;
};
export type UnderstandingPayload = {
    readonly intent: string;
    readonly contextSummary: string;
    readonly candidatePlans: readonly CandidatePlan[];
    /** UNKNOWN is first-class and preserved, never collapsed to a default. */
    readonly unknowns: readonly string[];
};
export type ConstitutionPayload = {
    /** Which frozen invariants/articles were applied to this decision. */
    readonly appliedInvariants: readonly string[];
    readonly stampFingerprint: string;
};
/**
 * The five Decision Basis inputs from the frozen architecture. Each is its own
 * gauge-tagged sub-section so the record is honest about which sensors are wired.
 * Today most are `unavailable` (see audit); Phase C slices connect them.
 */
export type DecisionBasisPayload = {
    readonly evidence: DecisionSection<unknown>;
    readonly policy: DecisionSection<unknown>;
    readonly constraints: DecisionSection<unknown>;
    readonly sourceOfRecord: DecisionSection<unknown>;
    readonly runtimeState: DecisionSection<unknown>;
    /**
     * Explicit Invocation Lineage (INV-EIL-4): the kind-banded reference claims this
     * invocation declared, threaded into the basis -- and ONLY the basis -- so Truth
     * Arbitration can re-arbitrate them and the certification grader can read their
     * authority bands. This mirrors `record.references` (same resolved edges); it is
     * the basis-side view that keeps references structurally basis-only (they never
     * reach ratification/execution). An empty array is the honest "no declared
     * reference" fact. Records persisted BEFORE S1b omit this field; readers MUST
     * treat absence as `[]` (gauge law), never fabricate.
     */
    readonly references: readonly ReferenceEdge[];
};
/**
 * Certification level for a governed decision's basis, DERIVED from the AUTHORITY
 * of the claims feeding the decision (core/k1 authority model, wired into the live
 * path by the Phase C "Certify" slice).
 *
 * This is NOT a fabricated confidence score. `certifiedConfidence` (below) is the
 * deterministic certifier's output (L3.S3) and is gated BY this certification:
 * only a certified_by_source basis can carry a number. Certification answers a
 * different, honest question:
 * "On what authority does this decision's basis rest?" -- a discrete classification
 * over real, connected record sections, never a guessed probability.
 *
 *   certified_by_source   -- the highest-authority claim is `source_of_record` /
 *                            `verified_system_state` and no unverified claim is in
 *                            conflict: the basis rests on verified ground.
 *   requires_human_review -- an unverified/unarbitrated claim is present (e.g. a
 *                            prior-observation loop input), OR the top authority is
 *                            `human_judgment`: a human must adjudicate.
 *   uncertified           -- only `agent_inference`/`unverified` claims and no
 *                            source anchor: a model proposal with nothing verified
 *                            to certify against.
 */
export type CertificationLevel = "certified_by_source" | "requires_human_review" | "uncertified";
/**
 * One claim that contributed to the certification, citing the connected record
 * section it was read from and its authority level (core/k1 vocabulary). Every
 * reason is derived from a real section -- never fabricated.
 */
export type CertificationReason = {
    readonly basis: string;
    readonly authorityLevel: AuthorityLevel;
};
export type Certification = {
    readonly level: CertificationLevel;
    readonly reasons: readonly CertificationReason[];
};
export type TruthArbitrationPayload = {
    readonly conflicts: readonly string[];
    readonly resolution: string;
    /**
     * Certified confidence, or the preserved literal "unknown".
     *
     * L3.S3 (Lane 3, Certify slice): computed by the deterministic confidence
     * certifier in truth-arbitration.ts — a DEFINED verification-coverage ratio
     * (verified sensor-backed basis inputs / 3 over evidence, cleared policy,
     * source of record), NOT a probability estimate. The resolution text states
     * the derivation verbatim. "unknown" remains the honest output whenever a
     * fail-closed gate fires: unarbitrated conflicts, certification level not
     * certified_by_source, a policy conflict_detected clearance, or a thin basis
     * with zero verified inputs. The certifier never manufactures confidence and
     * contains no LLM.
     */
    readonly certifiedConfidence: number | "unknown";
    /**
     * Evidence-anchored certification of the decision basis (core/k1 authority model
     * wired into the live path). Distinct from `certifiedConfidence`: it classifies
     * the AUTHORITY the basis rests on from real connected sections, never a score.
     */
    readonly certification: Certification;
    readonly preservedUnknowns: readonly string[];
};
export type RatificationDecision = "approved" | "rejected" | "changes_requested";
/**
 * Typed ratifier provenance — S1 (SYNTHETIC_OPERATOR_LANE_V1, INV-SO-2).
 *
 *   "human"   — a real human seat (TTY CLI, server-bound authenticated identity).
 *               The only kind that carries real authority in production.
 *   "persona" — a synthetic (LLM-created) ratifier seat, permitted on build-lane
 *               surfaces only. Zero authority in production: a production surface
 *               with a persona seat BLOCKS the decision (INV-SO-3, fail-closed).
 *
 * There is no third value and no casting path: a persona ratification can never
 * be stored, rendered, counted, or replayed as a human one. The ratification
 * stage structurally enforces agreement between this field and the reserved
 * `persona:` approver namespace.
 */
export type ApproverKind = "human" | "persona";
/**
 * Reserved approver namespace for synthetic (persona) ratifier seats.
 * A persona seat MUST identify as `persona:<id>`; the namespace is refused to
 * human seats. The ratification stage enforces agreement between this
 * namespace and `approverKind` in both directions (no casting path).
 */
export declare const PERSONA_APPROVER_PREFIX = "persona:";
export type RatificationPayload = {
    readonly decision: RatificationDecision;
    readonly approver: string;
    /**
     * Which kind of seat ratified (INV-SO-2). Always explicit on records written
     * after S1. Records persisted before S1 lack the field; readers must treat
     * absence as "unrecorded (pre-S1)" — never silently as "human".
     */
    readonly approverKind: ApproverKind;
    readonly at: string;
};
/**
 * The outcome of a single executed (or refused) operation.
 *
 * `status: "ran"` means the executor actuated the op against reality.
 * `status: "failed"` means it was refused (sandbox containment, overwrite guard)
 * or errored — captured honestly, never concealed. `detail` is verbatim from the
 * executor (a relative path on success, an error/refusal reason on failure).
 */
export type ExecutionOpResult = {
    readonly op: ExecutableOperation;
    readonly status: "ran" | "failed";
    readonly detail: string;
};
/**
 * One entry in a deterministic observation-scope snapshot (Collateral Mutation
 * Closure V1). Paths are POSIX-style (`/`-separated), relative to the workspace
 * root, and sorted by code unit — the representation is platform-deterministic
 * and mtime-free. `sha256` is the content hash of a `file`'s bytes, or of a
 * `symlink`'s link-target string (the link is never followed); it is ABSENT for
 * `dir` / `other` / `inaccessible` entries — gauge law: no fabricated hashes.
 * `inaccessible` marks an entry that EXISTS but could not be stat-read/listed —
 * it is recorded, never silently skipped.
 */
export type ScopeSnapshotEntry = {
    readonly path: string;
    readonly kind: "file" | "dir" | "symlink" | "other" | "inaccessible";
    readonly sha256?: string;
};
/**
 * The observer's post-actuation account of the declared observation scope
 * (Collateral Mutation Closure V1). Persisted on the observation section so the
 * record reconstructs: declared scope, post snapshot, and every unauthorized
 * delta (additions / modifications / deletions) the independent readback found.
 */
export type ScopeObservation = {
    /**
     * The declared observation scope, echoed VERBATIM from the execution
     * section's `observationScope` — never re-derived or substituted after
     * actuation.
     */
    readonly scope: readonly string[];
    /** The observer's independent post-actuation snapshot of the same scope. */
    readonly snapshotPost: readonly ScopeSnapshotEntry[];
    /** Snapshot paths present after but not before, outside the authorized delta. */
    readonly unauthorizedAdditions: readonly string[];
    /** Snapshot paths present at both times with changed kind/hash, outside the authorized delta. */
    readonly unauthorizedModifications: readonly string[];
    /** Snapshot paths present before but not after, outside the authorized delta. */
    readonly unauthorizedDeletions: readonly string[];
};
export type ExecutionPayload = {
    /** Did the SDK execute exactly what was ratified? */
    readonly ranWhatWasApproved: boolean;
    readonly deterministic: boolean;
    readonly steps: readonly string[];
    /**
     * Per-operation outcome when a real executor actuated the approved ops. ABSENT
     * (not [], not fabricated) when no executor ran — keeping prior honest-default
     * records (execution unavailable) and the reference path valid. Gauge law.
     */
    readonly results?: readonly ExecutionOpResult[];
    /**
     * The DECLARED observation scope (Collateral Mutation Closure V1): the sorted
     * set of workspace-relative directories the approved ops touch, derived by a
     * pure function of the ratified (fingerprinted) ops and captured BEFORE
     * actuation. ABSENT when no scope sensor was wired or the plan carried no
     * filesystem op — never inferred after execution. The executor never sees or
     * influences it.
     */
    readonly observationScope?: readonly string[];
    /**
     * The pre-actuation snapshot of `observationScope`, captured through the
     * observer's read path (never the executor) immediately before invocation.
     * ABSENT when no scope sensor was wired.
     */
    readonly scopeSnapshotPre?: readonly ScopeSnapshotEntry[];
    /**
     * Present ONLY when a scope sensor was wired but the pre-actuation capture
     * itself failed — an explicit capture failure, distinguishable from "no
     * sensor wired" (both fields absent). Gauge law: a failed capture is stated,
     * never smoothed over.
     */
    readonly observationScopeError?: string;
};
export type RealityVerdict = "agree" | "disagree" | "unknown";
export type ObservationPayload = {
    readonly whatHappened: string;
    readonly intendedVsActual: "match" | "deviation" | "unknown";
    readonly realityVerdict: RealityVerdict;
    /**
     * Human-readable description of WHAT the reality probe checked and found, when a
     * probe is wired (e.g. "verified 2 actuated op(s) present on disk" or "reality
     * contradicts 1/2 claimed op(s): reports/out.txt content differs"). ABSENT (not
     * "", not fabricated) when no probe ran — gauge law. Carries no authority; it
     * explains the `realityVerdict`, it does not set it.
     */
    readonly realityDetail?: string;
    /**
     * The observer's collateral account of the declared observation scope
     * (Collateral Mutation Closure V1), relayed verbatim from the reality probe.
     * ABSENT (not fabricated) when the execution section carried no declared
     * scope/snapshot — gauge law. When present with any non-empty unauthorized
     * list, `realityVerdict` is `disagree` (an unauthorized in-scope delta is a
     * disagreement between the approved and the actual execution).
     */
    readonly scopeObservation?: ScopeObservation;
    /**
     * Whether this observation is eligible to feed the NEXT cycle's Decision Basis
     * (automatic loop, ratified v1). It feeds basis only — never authority or
     * execution. See the loop guardrail in the canonical architecture doc.
     */
    readonly feedsNextCycle: boolean;
};
export type HumanIntent = {
    readonly goal: string;
    readonly constraints: readonly string[];
};
export type ReferenceKind = "prior_observation" | "certified_decision" | "verified_artifact" | "asserted_artifact";
/**
 * A declared reference input. The caller declares a dependency; it CANNOT
 * self-certify authority (no `verified` flag here on purpose -- INV-EIL-5: only
 * an in-invocation kernel sensor may assert re-verification).
 */
export type Reference = {
    readonly kind: ReferenceKind;
    /** The declared target: a recordId, artifact id, or path. */
    readonly ref: string;
};
/**
 * A resolved lineage edge recorded on the GovernedDecisionRecord. The
 * `authorityBand` and `verifiedInThisInvocation` are KERNEL-determined at
 * resolution, never copied from the caller. The A -> B -> C lineage graph is
 * reconstructable from these edges across stored records (INV-EIL-6).
 */
export type ReferenceEdge = {
    readonly kind: ReferenceKind;
    readonly ref: string;
    readonly authorityBand: AuthorityLevel;
    readonly verifiedInThisInvocation: boolean;
};
/**
 * Map a reference KIND (+ whether the kernel re-verified it in THIS invocation)
 * to its entry authority band, in core/k1's vocabulary. Pure and total.
 *
 * INV-EIL-5: a `verified_artifact` reaches `verified_system_state` ONLY when a
 * kernel sensor re-verified it in the current invocation. Until such a sensor is
 * wired, `verified` is always false and the artifact honestly degrades to the
 * `unverified` band (no inherited or self-asserted authority).
 */
export declare function referenceAuthorityBand(kind: ReferenceKind, verifiedInThisInvocation: boolean): AuthorityLevel;
/**
 * The single canonical object. Append-only and content-hashed (`recordId`).
 * The projection layer reads this and only this.
 */
export type GovernedDecisionRecord = {
    readonly recordId: string;
    readonly createdAt: string;
    readonly humanIntent: HumanIntent;
    readonly understanding: DecisionSection<UnderstandingPayload>;
    readonly constitution: DecisionSection<ConstitutionPayload>;
    readonly decisionBasis: DecisionSection<DecisionBasisPayload>;
    readonly truthArbitration: DecisionSection<TruthArbitrationPayload>;
    readonly ratification: DecisionSection<RatificationPayload>;
    readonly execution: DecisionSection<ExecutionPayload>;
    readonly observation: DecisionSection<ObservationPayload>;
    /**
     * Automatic-loop input: reference to a prior record's observation that fed
     * this cycle's Decision Basis. `null` when this is a fresh (un-fed) decision.
     *
     * Retained for back-compat; it is the projection of the single
     * `prior_observation` edge in `references` (which is the general, first-class
     * lineage record -- see below).
     */
    readonly priorObservationRef: string | null;
    /**
     * Explicit Invocation Lineage (INV-EIL-2, INV-EIL-6): the DECLARED reference
     * edges this invocation depended on, kernel-resolved with their authority band.
     * Append-only and part of the content hash. Empty when the invocation declared
     * no dependency (a fresh invocation). The A -> B -> C lineage graph is
     * reconstructable from `references[].ref` across stored records alone -- no
     * session, no implicit memory.
     */
    readonly references: readonly ReferenceEdge[];
};
//# sourceMappingURL=types.d.ts.map