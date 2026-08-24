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
import { invokeSkillsForTrigger } from "./invocation.js";
import type { LoadedSkillRegistry } from "./types.js";
export type SuggestionDeps = {
    readonly registry: LoadedSkillRegistry;
    readonly adapter: Parameters<typeof invokeSkillsForTrigger>[0]["adapter"];
};
export declare function concreteSuggestions(rawInput: string, deps: SuggestionDeps): Promise<readonly {
    input: string;
    reason: string;
}[]>;
//# sourceMappingURL=concrete-suggestions.d.ts.map