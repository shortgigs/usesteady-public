/**
 * Credential detection — pure helpers over the provider registry.
 *
 * Issue: #150 — "add provider-agnostic credential pre-flight blocking".
 *
 * Authority: none. This module has zero side effects. It reads
 * `process.env` (synchronously) and returns values. It never writes,
 * prompts, or performs I/O.
 *
 * Contract:
 *
 *   - `isProviderConfigured(p)`  → envKey is set to a non-empty string
 *   - `isProviderLive(p)`        → provider's live-mode gate is satisfied
 *                                  (see AIProvider.liveModeEnv)
 *   - `runtimeToProviderId(rt)`  → provider id for a workflow task runtime,
 *                                  or null if the runtime needs no provider
 *   - `buildRequiredProviderIds(rts)` → deduped provider ids needed to run
 *                                  the given list of task runtimes
 *   - `getMissingProviders(ids)` → providers that are required AND not
 *                                  configured. Order matches PROVIDERS.
 *   - `getProviderStatuses()`    → DTO for the UI (`/api/providers/status`)
 *
 * This module is the single canonical source of truth for "live mode" and
 * "missing credentials". The server endpoint and the CLI guard both call
 * these functions. No divergence is possible — there is only one
 * implementation of each predicate.
 */
import { type AIProvider } from "../config/providers.js";
export declare function getProviderById(id: string): AIProvider | null;
export declare function isProviderConfigured(p: AIProvider): boolean;
/**
 * True when this provider would make real API calls right now.
 *
 * A provider with no `liveModeEnv` is always live. A provider with one
 * must have `process.env[liveModeEnv] === liveModeEnvExpectedValue`.
 */
export declare function isProviderLive(p: AIProvider): boolean;
export declare function runtimeToProviderId(runtime: string): string | null;
/**
 * Deduplicated list of provider ids required by the given runtimes.
 * Runtimes that don't map to any provider are silently dropped — they
 * run locally (e.g. `cursor`) and need no credentials.
 */
export declare function buildRequiredProviderIds(runtimes: readonly string[]): readonly string[];
/**
 * Providers that are both (a) in the required list and (b) not configured.
 *
 * Unknown ids are filtered out (defensive). Order follows PROVIDERS so the
 * UI / CLI render in a stable sequence.
 */
export declare function getMissingProviders(requiredProviderIds: readonly string[]): readonly AIProvider[];
export type ProviderStatusDto = {
    readonly id: string;
    readonly displayName: string;
    readonly envKey: string;
    readonly setupUrl?: string;
    readonly runtimes: readonly string[];
    readonly configured: boolean;
    readonly liveMode: boolean;
};
/**
 * Snapshot of every known provider's current credential + live-mode state.
 * This is the payload returned by `GET /api/providers/status`. The UI uses
 * it to decide: block start, show demo-mode hint, or proceed silently.
 *
 * NEVER include secret values (the key itself) in this DTO. Only the
 * presence boolean is exposed.
 */
export declare function getProviderStatuses(): readonly ProviderStatusDto[];
//# sourceMappingURL=credentials.d.ts.map