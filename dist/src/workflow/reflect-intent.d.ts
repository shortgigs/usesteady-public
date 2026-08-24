/**
 * reflectIntentDeterministic — deterministic REFLECTION artifact engine.
 *
 * Relocated from `scripts/runtime-reflect-intent.ts` into `src/` (R2 layering
 * fix). `src/` must never import from `scripts/`: `scripts/` is dev/CI tooling
 * that is NOT shipped in the npm package, so a `src/ -> scripts/` import is a
 * runtime-missing-module risk for installed clients. The engine now lives next
 * to its sole production consumer (`src/workflow/route-to-surface.ts`). The
 * certification script and tests import it from here.
 *
 * Zero authority: this maps an unparseable request to a descriptive
 * ReflectionArtifact ("here is what I believe you mean"). It never executes,
 * approves, or gates. Returns `null` for primitive inputs so they fall through
 * to the existing deterministic ReviewingFrame path.
 */
export interface ReflectionArtifact {
    readonly classification: "initiative" | "capability" | "program" | "refactor" | "structure" | "primitive" | "unknown";
    readonly summary: string;
    readonly key_points: readonly string[];
    readonly next_step: string;
    readonly originalRequest: string;
}
export declare function reflectIntentDeterministic(input: string): ReflectionArtifact | null;
//# sourceMappingURL=reflect-intent.d.ts.map