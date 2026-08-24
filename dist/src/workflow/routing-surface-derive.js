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
import { buildFsChangeFromSpec } from "./coordinator.js";
import { willSurface, suggestSurface, reflectionSurface, clarifySurface, safetySurface, workPlanSurface, } from "./routing-surface.js";
// ─── safety ───────────────────────────────────────────────────────────────────
/** Map a blocking SpecSafetyVerdict to a SafetySurface. Returns null on allow. */
export function safetySurfaceFromVerdict(verdict) {
    if (verdict.verdict !== "block")
        return null;
    return safetySurface({
        reason: verdict.reason ?? "blocked",
        note: verdict.note ?? "This request was blocked by the safety gate.",
        blockedInput: verdict.blockedInput,
        matchedPattern: verdict.matchedPattern,
        detectorId: verdict.detectorId,
    });
}
// ─── clarify (slot-fill) ───────────────────────────────────────────────────────
export function clarifySlotSurface(args) {
    return clarifySurface({
        mode: "slot_fill",
        kind: args.kind,
        slot: args.slot,
        prompt: args.prompt,
        originalInput: args.originalInput,
    });
}
// ─── clarify (commitment) ──────────────────────────────────────────────────────
export function clarifyCommitmentSurface(commitment, originalInput) {
    return clarifySurface({ mode: "commitment", commitment, originalInput });
}
// ─── reflection ────────────────────────────────────────────────────────────────
/**
 * Map a deterministic IntentReflectionArtifact (the shape returned by
 * reflectIntentDeterministic) to a ReflectionSurface. Returns null when no
 * reflection was produced.
 */
export function reflectionSurfaceFromArtifact(artifact) {
    if (!artifact)
        return null;
    return reflectionSurface({
        classification: artifact.classification,
        summary: artifact.summary,
        keyPoints: artifact.key_points,
        nextStep: artifact.next_step,
        originalRequest: artifact.originalRequest,
    });
}
// ─── system_suggests ───────────────────────────────────────────────────────────
/** Map concrete recovery suggestion items to a SuggestSurface. */
export function suggestSurfaceFromItems(items) {
    if (items.length === 0)
        return null;
    return suggestSurface(items);
}
// ─── system_will ───────────────────────────────────────────────────────────────
/**
 * The executable operation for a deterministic task spec. Reuses
 * `buildFsChangeFromSpec` (the same mapper the coordinator uses) so the surface
 * cannot drift from what actually executes. The only op not modelled by
 * FsChange is `replace` (carried as `structuredReplace`).
 *
 * Returns null when the task is not a deterministic single op.
 */
export function willOperationFromTaskSpec(task) {
    const fsChange = buildFsChangeFromSpec(task);
    if (fsChange)
        return fsChange;
    if ((task.operationType === undefined || task.operationType === "replace") &&
        task.structuredReplace) {
        return {
            operationType: "replace",
            filePath: task.structuredReplace.filePath,
            oldValue: task.structuredReplace.oldValue,
            newValue: task.structuredReplace.newValue,
        };
    }
    return null;
}
/**
 * Build a WillSurface for a deterministic task. `headline` is supplied by the
 * caller from the canonical SYSTEM WILL summary (derived once in the engine via
 * specToExecutionSteps -> system_will.summary), satisfying Q4 (one truthful
 * headline shared by every renderer). Returns null when no executable op exists.
 */
export function willSurfaceFromTaskSpec(task, headline) {
    const operation = willOperationFromTaskSpec(task);
    if (!operation)
        return null;
    return willSurface({ operation, headline });
}
// ─── work_plan ─────────────────────────────────────────────────────────────────
/**
 * Map a generated WorkPlan to a WorkPlanSurface. Returns null when no plan was
 * produced. Completes the derive set so every SurfaceType has a derivation; the
 * CLI/web entry wiring of the work_plan surface is deferred to a named work-plan
 * phase (the CLI does not generate WorkPlans for NL input today).
 */
export function workPlanSurfaceFromPlan(plan) {
    if (!plan)
        return null;
    return workPlanSurface(plan);
}
//# sourceMappingURL=routing-surface-derive.js.map