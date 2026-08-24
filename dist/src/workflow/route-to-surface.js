/**
 * routeRequestToSurface — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 3C-2).
 *
 * The single shared three-outcome routing brain. Given the synthesized first task
 * of a request, it decides the truthful pre-execution surface and returns it as a
 * RoutingSurface engine object:
 *
 *   SYSTEM WILL     — the runtime can construct a truthful, executable proposal
 *                     (`isDeliverableTaskSpec`); headline is the canonical
 *                     SYSTEM WILL summary (Q4 single-headline contract).
 *   SYSTEM SUGGESTS — no guaranteed execution, but a concrete zero-authority
 *                     proposal exists (`suggest` returns items).
 *   Reflection      — no concrete proposal can honestly be formed.
 *
 * Both the web server (server.ts) and the CLI consume THIS function, so the two
 * surfaces cannot diverge on the routing decision. `suggest` (concrete recovery
 * suggestions) is injected because the skills registry/adapter are owned by each
 * caller's bootstrap; the decision logic itself lives here, once.
 *
 * Zero authority (Invariant 1): this maps a request to a descriptive surface; it
 * never executes, approves, or gates. The order of checks is the authority — it
 * is identical to the order the coordinator and the approval gate assume.
 */
import { isDeliverableTaskSpec } from "./coordinator.js";
import { willSurfaceFromTaskSpec, suggestSurfaceFromItems, reflectionSurfaceFromArtifact, } from "./routing-surface-derive.js";
import { specToExecutionSteps } from "../execution/spec-to-execution-steps.js";
import { reflectIntentDeterministic } from "./reflect-intent.js";
export async function routeRequestToSurface(args) {
    const { firstTask, synthesizedSpec, root, suggest } = args;
    const firstTaskInput = firstTask?.input ?? "";
    const canConstructSystemWill = firstTask ? isDeliverableTaskSpec(firstTask) : false;
    if (canConstructSystemWill && firstTask) {
        // Q4 single-headline contract: derive the headline from the SAME spec the
        // operation is derived from (synthesizedSpec), so a synthesized concrete op
        // never pairs with a generic pre-synthesis summary.
        const headline = specToExecutionSteps(synthesizedSpec, root)[0]?.system_will.summary
            ?? `Run: "${firstTaskInput}"`;
        return {
            surface: willSurfaceFromTaskSpec(firstTask, headline) ?? undefined,
            intentReflection: null,
        };
    }
    const suggestItems = await suggest(firstTaskInput);
    if (suggestItems.length > 0) {
        return {
            surface: suggestSurfaceFromItems(suggestItems) ?? undefined,
            intentReflection: null,
        };
    }
    const intentReflection = reflectIntentDeterministic(firstTaskInput);
    return {
        surface: reflectionSurfaceFromArtifact(intentReflection) ?? undefined,
        intentReflection,
    };
}
//# sourceMappingURL=route-to-surface.js.map