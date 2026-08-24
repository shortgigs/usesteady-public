/**
 * concreteSuggestions — shared three-outcome routing probe (Phase 3C-3).
 *
 * For an input the runtime cannot turn into a deterministic SYSTEM WILL, decide
 * whether a truthful SYSTEM SUGGESTS exists. A non-empty result means a concrete,
 * zero-authority proposal the human can adopt; an empty result means no honest
 * proposal can be formed (the request belongs in Reflection).
 *
 * Extracted so the web server and the CLI run the SAME suggestion logic (the
 * `suggest` dependency of `routeRequestToSurface`). The skills registry + adapter
 * are injected because each caller owns its own bootstrap lifecycle (the server
 * eager-scans at startup; the CLI builds a per-process registry lazily). Same
 * deterministic `LocalRecoveryAdapter`; never throws.
 */
import { shouldConsultSkills } from "./registry.js";
import { invokeSkillsForTrigger } from "./invocation.js";
export async function concreteSuggestions(rawInput, deps) {
    const trimmed = rawInput.trim();
    if (!trimmed)
        return [];
    const trigger = { kind: "recovery", failureReason: "unsupported", rawInput: trimmed };
    if (!shouldConsultSkills(deps.registry, trigger))
        return [];
    try {
        const result = await invokeSkillsForTrigger({
            registry: deps.registry,
            triggerReason: trigger,
            rawInput: trimmed,
            adapter: deps.adapter,
        });
        return result.accepted.flatMap((output) => output.schema === "usesteady.recovery_suggestions.v1"
            ? output.suggestions.map((s) => ({
                input: s.input,
                reason: s.reason,
            }))
            : []);
    }
    catch (err) {
        process.stderr.write(`[skills] concreteSuggestions error: ${String(err)}\n`);
        return [];
    }
}
//# sourceMappingURL=concrete-suggestions.js.map