/**
 * RoutingSurface derivation — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 3A wiring).
 *
 * Pure re-expression of the routing decisions the /api/workflow/start handler
 * already makes, into the serializable RoutingSurface engine object. This module
 * holds NO routing authority: it never decides which surface applies; the caller
 * (server.ts) passes the already-decided inputs and this maps them to the typed,
 * JSON-safe surface. server.ts and scripts/cert-routing-surface.ts import THESE
 * functions so the cert exercises the real engine object (shared-module
 * discipline, matching clarify-surface.ts).
 *
 * Zero authority (Invariant 1): the surfaces returned here describe; nothing in
 * this module executes, approves, or gates.
 */
import type { WorkflowTaskSpec } from "./types.js";
import type { ClarifyCommitment } from "./clarify-surface.js";
import type { SpecSafetyVerdict } from "./spec-safety-gate.js";
import type { WorkPlan } from "./work-plan-types.js";
import { type WillOperation, type WillSurface, type SuggestSurface, type ReflectionSurface, type ClarifySurface, type SafetySurface, type WorkPlanSurface, type SuggestSurfaceItem } from "./routing-surface.js";
/** Map a blocking SpecSafetyVerdict to a SafetySurface. Returns null on allow. */
export declare function safetySurfaceFromVerdict(verdict: SpecSafetyVerdict): SafetySurface | null;
export declare function clarifySlotSurface(args: {
    kind: "missing_destination" | "ambiguous_type";
    slot: "destination" | "file_or_folder";
    prompt: string;
    originalInput: string;
}): ClarifySurface;
export declare function clarifyCommitmentSurface(commitment: ClarifyCommitment, originalInput: string): ClarifySurface;
/**
 * Map a deterministic IntentReflectionArtifact (the shape returned by
 * reflectIntentDeterministic) to a ReflectionSurface. Returns null when no
 * reflection was produced.
 */
export declare function reflectionSurfaceFromArtifact(artifact: {
    classification: ReflectionSurface["classification"];
    summary: string;
    key_points: readonly string[];
    next_step: string;
    originalRequest: string;
} | null): ReflectionSurface | null;
/** Map concrete recovery suggestion items to a SuggestSurface. */
export declare function suggestSurfaceFromItems(items: readonly SuggestSurfaceItem[]): SuggestSurface | null;
/**
 * The executable operation for a deterministic task spec. Reuses
 * `buildFsChangeFromSpec` (the same mapper the coordinator uses) so the surface
 * cannot drift from what actually executes. The only op not modelled by
 * FsChange is `replace` (carried as `structuredReplace`).
 *
 * Returns null when the task is not a deterministic single op.
 */
export declare function willOperationFromTaskSpec(task: WorkflowTaskSpec): WillOperation | null;
/**
 * Build a WillSurface for a deterministic task. `headline` is supplied by the
 * caller from the canonical SYSTEM WILL summary (derived once in the engine via
 * specToExecutionSteps -> system_will.summary), satisfying Q4 (one truthful
 * headline shared by every renderer). Returns null when no executable op exists.
 */
export declare function willSurfaceFromTaskSpec(task: WorkflowTaskSpec, headline: string): WillSurface | null;
/**
 * Map a generated WorkPlan to a WorkPlanSurface. Returns null when no plan was
 * produced. Completes the derive set so every SurfaceType has a derivation; the
 * CLI/web entry wiring of the work_plan surface is deferred to a named work-plan
 * phase (the CLI does not generate WorkPlans for NL input today).
 */
export declare function workPlanSurfaceFromPlan(plan: WorkPlan | null): WorkPlanSurface | null;
//# sourceMappingURL=routing-surface-derive.d.ts.map