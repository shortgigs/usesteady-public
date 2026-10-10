/**
 * UseSteady internal Agent SDK — types (Phase 5).
 *
 * INTERNAL, non-public. NOT re-exported from `src/index.ts`. This is the
 * integration layer for hosts (Claude Code / Cursor) that want the engine
 * pipeline `Proposal -> RoutingSurface -> DecisionBasis -> Approval` as typed
 * objects, with NO UI, NO CLI, NO React, NO terminal.
 *
 * Zero authority: the SDK describes, fingerprints, and records a decision. It
 * never executes, mutates the workspace, or triggers a run. Execution stays
 * behind the existing workflow approval/execution gate (`createWorkflowRun` ->
 * `advanceWorkflow`, which independently re-verifies the fingerprint).
 */

import type { WorkflowSpec } from "../workflow/types.js";
import type { SuggestFn } from "../workflow/route-to-surface.js";
import type { RoutingSurface } from "../workflow/routing-surface.js";
import type { SpecSafetyVerdict } from "../workflow/spec-safety-gate.js";
import type {
  ApprovalRecord,
  DecisionBasis,
  DecisionBasisFingerprintVerification,
} from "../constitution/index.js";

/**
 * The single canonical proposal name the SDK assigns to EVERY spec it builds.
 *
 * Resolution to the Phase 4 follow-up: `assembleDecisionBasis` embeds
 * `proposal.name = spec.name`, so the fingerprint (and `deriveWorkflowRunId`)
 * are name-sensitive. By always assigning this one name, the SDK's fingerprint
 * and run id are guaranteed to equal what `createWorkflowRun(plan.spec, ...)`
 * produces for the same canonical spec — so a captured ApprovalRecord binds to
 * the run the host later executes. No change to the frozen Article VI hash.
 */
export const SDK_CANONICAL_SPEC_NAME = "usesteady.sdk.proposal" as const;

/** A proposal is either bare natural language or a fully-structured spec. */
export type SdkProposalInput =
  | { readonly kind: "nl"; readonly rawInput: string }
  | { readonly kind: "spec"; readonly spec: WorkflowSpec };

/**
 * Host-supplied context. `suggest` is REQUIRED (keeps `plan()` deterministic and
 * avoids `exactOptionalPropertyTypes` friction) — pass `noSuggestions` for none.
 *
 * NOTE (Phase 5, deliberate): no `repository` field. The SDK builds a SPEC-ONLY
 * Decision Basis (`repository: null`), identical to both production surfaces
 * (Web/CLI) today. This makes the binding guarantee UNCONDITIONAL —
 * `planProposal(...).decisionBasisFingerprint === createWorkflowRun(plan.spec)
 * .decisionBasisFingerprint` always holds. Threading repository provenance into
 * the basis would only bind correctly if the host passed the SAME fact to
 * `createWorkflowRun` AND `advanceWorkflow`; that cross-call contract is a
 * deferred follow-up, not Phase 5 scope.
 */
export type SdkContext = {
  readonly root: string;
  readonly suggest: SuggestFn;
};

/** Always-empty suggestion provider — deterministic default for hosts. */
export const noSuggestions: SuggestFn = async () => [];

/**
 * The pre-execution plan: the first three pipeline stages, fully typed.
 *
 * `spec` is the canonical spec the host MUST create the run from (so the run's
 * recomputed fingerprint/id match what the SDK recorded). `surface` is undefined
 * iff safety blocked (the router is never consulted on a block).
 */
export type SdkPlan = {
  readonly rawInput: string;
  readonly specName: typeof SDK_CANONICAL_SPEC_NAME;
  readonly spec: WorkflowSpec;
  readonly safety: SpecSafetyVerdict;
  readonly surface: RoutingSurface | undefined;
  readonly intentReflection: unknown;
  readonly decisionBasis: DecisionBasis;
  readonly decisionBasisFingerprint: string;
  readonly workflowRunId: string;
};

/** Request to capture an approval bound to a plan's fingerprint. */
export type SdkApprovalRequest = {
  readonly plan: SdkPlan;
  /** Host-supplied store directory (path-agnostic, like UCP persistence). */
  readonly storeDir: string;
  /** Injectable ISO-8601 clock for deterministic tests; defaults to now. */
  readonly capturedAt?: string;
};

/** Result of capturing an approval: the durable record + a re-verification. */
export type SdkApprovalResult = {
  readonly record: ApprovalRecord;
  readonly verification: DecisionBasisFingerprintVerification;
};
