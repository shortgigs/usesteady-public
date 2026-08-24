/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - opt-in resolution.
 *
 * INV-ERB-P1: DEFAULT OFF. Reporting is enabled ONLY when the buyer explicitly
 * opts in (per-run `--report-to-portal` flag) AND the destination URL AND the
 * entitlement bearer token are both present. Any missing piece => disabled, with
 * a structured reason (no throw, no partial send).
 *
 * Env vars (resolved on the machine):
 *   - USESTEADY_PORTAL_RUNS_URL : Portal base URL (e.g. https://app.usesteady.dev)
 *   - USESTEADY_PORTAL_TOKEN    : entitlement-derived bearer token
 */
export type PortalReportingConfig = {
    readonly enabled: true;
    readonly url: string;
    readonly token: string;
} | {
    readonly enabled: false;
    readonly reason: PortalReportingDisabledReason;
};
export type PortalReportingDisabledReason = "opt_in_off" | "no_url" | "no_token" | "invalid_runs_url_suffix";
/**
 * Portal base URL only. Rejects values that already include the ingest path
 * (common operator mistake → double path → HTTP 404).
 */
export declare function normalizePortalRunsBaseUrl(raw: string): {
    readonly ok: true;
    readonly url: string;
} | {
    readonly ok: false;
    readonly reason: "invalid_runs_url_suffix";
};
export declare const PORTAL_RUNS_URL_ENV = "USESTEADY_PORTAL_RUNS_URL";
export declare const PORTAL_TOKEN_ENV = "USESTEADY_PORTAL_TOKEN";
export declare function resolvePortalReporting(input: {
    /** The per-run --report-to-portal flag. */
    readonly flag: boolean;
    readonly env?: Readonly<Record<string, string | undefined>>;
}): PortalReportingConfig;
//# sourceMappingURL=opt-in.d.ts.map