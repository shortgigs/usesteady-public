/**
 * Read-only observation probes (INV-DIAG-IMPL-1, INV-DIAG-IMPL-8).
 */
import { type EffectiveState, type EntitlementCacheRecord } from "../shell/cli/entitlement-cache.js";
import type { DiagnosticObservation } from "./types.js";
export declare function readUseSteadyConfig(): Record<string, unknown> | null;
export declare function probeIdentityObservations(env?: NodeJS.ProcessEnv): DiagnosticObservation[];
export declare function probeRuntimeObservations(env?: NodeJS.ProcessEnv): DiagnosticObservation[];
export declare function probePortalObservations(env?: NodeJS.ProcessEnv): DiagnosticObservation[];
export declare function probeEntitlementObservationsFromCache(input: {
    cache: EntitlementCacheRecord | null;
    effective: EffectiveState;
    now?: Date;
}): DiagnosticObservation[];
export declare function probeBillingObservations(input: {
    orgId: string | null;
    issuerReachable: boolean;
    issuerState?: string | null;
}): DiagnosticObservation[];
export declare function collectLocalObservations(env?: NodeJS.ProcessEnv, cachePath?: string, now?: Date): {
    observations: DiagnosticObservation[];
    effective: EffectiveState;
    cache: EntitlementCacheRecord | null;
};
export declare function collectIssuerObservations(env?: NodeJS.ProcessEnv, deps?: {
    fetchImpl?: typeof fetch;
}): Promise<DiagnosticObservation[]>;
export declare function collectObservations(input: {
    env?: NodeJS.ProcessEnv;
    cachePath?: string;
    probeIssuer?: boolean;
    now?: Date;
    fetchImpl?: typeof fetch;
}): Promise<{
    observations: DiagnosticObservation[];
    effective: EffectiveState;
}>;
//# sourceMappingURL=observe.d.ts.map