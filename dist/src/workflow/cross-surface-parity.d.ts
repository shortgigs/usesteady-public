/**
 * cross-surface-parity — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 4).
 *
 * The single source of truth for the pre-execution ENGINE OBJECTS that the Web
 * (`server.ts` POST /api/workflow/start) and the CLI (`use-steady.ts`
 * cliRecoverySurface / delegateRawInputToWorkflow) must agree on for the same NL
 * input. The renderers (renderSurfaceCli, renderSurfaceWeb) may differ; the
 * objects below must not.
 *
 * Closed set of parity-bound artifacts:
 *   - SpecSafetyVerdict     (Phase 2 single-authority safety, AHEAD of routing)
 *   - RoutingSurface        (the shared three-outcome brain, routeRequestToSurface)
 *   - intentReflection      (the deterministic REFLECTION artifact, when it fires)
 *   - DecisionBasis         (Article VI eight-class basis of the proposal)
 *   - decisionBasisFingerprint (SHA-256 of the basis — what an ApprovalRecord binds)
 *
 * Why this exists: Phase 3C proved the routing BRAIN is shared and the two
 * renderers are total/pure. Phase 4 proves the OBJECTS are byte-identical across
 * surfaces by computing them ONCE here, from the same shared engine functions
 * both surfaces already call (`synthesizeStructuredFieldsFromNL`,
 * `gateWorkflowSpecSafety`, `routeRequestToSurface`, `assembleDecisionBasis`,
 * `computeDecisionBasisFingerprint`). The parity test and totality cert drive
 * this module and assert the renderers are pure projections of `surface`.
 *
 * Zero authority (Invariant 1): nothing here executes, approves, gates, or
 * touches the filesystem. It is a pure, deterministic projection of
 * (rawInput, root, suggest, repository).
 *
 * Determinism + the single surface-assigned field: `assembleDecisionBasis`
 * embeds `proposal.name = spec.name`, which is cosmetic metadata each surface
 * assigns differently (Web: request name; CLI recovery: "NL recovery"). It is
 * NOT input-derived, so the cross-surface parity claim canonicalizes it out
 * (see `proposalContentKey`) and asserts parity on the proposal TASKS plus the
 * repository / configuration / policies facts. The fingerprint is reported as a
 * function of the canonical spec name this module assigns, so callers comparing
 * fingerprints across surfaces must use the same `specName`.
 */
import type { WorkflowSpec, WorkflowTaskSpec } from "./types.js";
import type { RoutingSurface } from "./routing-surface.js";
import type { SuggestFn } from "./route-to-surface.js";
import type { SpecSafetyVerdict } from "./spec-safety-gate.js";
import type { DecisionBasis, RepositoryProvenanceFact } from "../constitution/index.js";
/** The closed set of pre-execution engine artifacts both surfaces must agree on. */
export type CrossSurfaceArtifacts = {
    readonly rawInput: string;
    /** The cosmetic, surface-assigned proposal name this computation used. */
    readonly specName: string;
    readonly safety: SpecSafetyVerdict;
    /** undefined when safety blocked (router not consulted) — mirrors both surfaces. */
    readonly surface: RoutingSurface | undefined;
    /** The deterministic REFLECTION artifact, when the reflection branch fired. */
    readonly intentReflection: unknown;
    readonly decisionBasis: DecisionBasis;
    readonly decisionBasisFingerprint: string;
    /** ApprovalRecord projection with nondeterministic fields removed (unwired today). */
    readonly approvalParity: {
        readonly decisionBasisFingerprint: string;
    };
};
/**
 * Build the canonical synthesized first task for a bare-NL input via the SINGLE
 * canonical synth both surfaces use. Failed synthesis falls back to raw `input`
 * only (recovery-eligible), exactly as `server.ts` and `cliRecoverySurface` do.
 */
export declare function synthesizeFirstTaskFromNL(rawInput: string): WorkflowTaskSpec;
/**
 * Build the canonical single-task synthesized spec for an NL input. `name` is
 * cosmetic (see module header) — callers comparing fingerprints across surfaces
 * must pass the SAME name.
 */
export declare function buildSynthesizedSpecFromNL(rawInput: string, name: string): WorkflowSpec;
/**
 * The shared engine core: compute the cross-surface artifacts for an already-
 * built `WorkflowSpec`, in the exact order both surfaces apply them — safety
 * (single authority, ahead of routing) -> route (skipped on block) -> decision
 * basis + fingerprint. This is the single ordering authority; `computeCross-
 * SurfaceArtifacts` (NL entry) and the internal SDK both delegate here so the
 * safety-ahead-of-routing invariant lives in exactly one place.
 */
export declare function computeArtifactsForSpec(args: {
    readonly spec: WorkflowSpec;
    readonly root: string;
    readonly suggest: SuggestFn;
    readonly repository?: RepositoryProvenanceFact | null;
}): Promise<CrossSurfaceArtifacts>;
/**
 * Compute the full set of cross-surface engine artifacts for an NL input, in the
 * exact order both surfaces apply them: synthesize -> safety (single authority,
 * ahead of routing) -> route (skipped on block) -> decision basis + fingerprint.
 */
export declare function computeCrossSurfaceArtifacts(args: {
    readonly rawInput: string;
    readonly root: string;
    readonly suggest: SuggestFn;
    readonly repository?: RepositoryProvenanceFact | null;
    /** Cosmetic proposal name; defaults to a deterministic, input-derived value. */
    readonly specName?: string;
}): Promise<CrossSurfaceArtifacts>;
/** Stable, sorted-key JSON serialization for deterministic object diffing. */
export declare function canonicalize(value: unknown): string;
/** Full canonical serialization of every parity-bound artifact. */
export declare function canonicalizeArtifacts(a: CrossSurfaceArtifacts): string;
/**
 * The name-INDEPENDENT engine objects — safety verdict, routing surface, and the
 * reflection artifact. This is the strong parity key: identical across surfaces
 * regardless of the cosmetic proposal name each assigns.
 */
export declare function surfaceParityKey(a: CrossSurfaceArtifacts): string;
/**
 * The proposal CONTENT of a DecisionBasis with the surface-assigned cosmetic
 * `proposal.name` removed — the trust-relevant facts that must match across
 * surfaces for the same input (tasks + repository + configuration + policies).
 */
export declare function proposalContentKey(basis: DecisionBasis): string;
//# sourceMappingURL=cross-surface-parity.d.ts.map