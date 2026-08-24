/**
 * usesteady doctor -- read-only environment / install readiness checks.
 *
 * Pure probe + render module. Design lock:
 * docs/product/usesteady-doctor-design-v1.md
 *
 * Authority:
 *   - Does not execute, approve, load specs, or mutate config.
 *   - The only filesystem write is the ephemeral D5 store-writable probe
 *     (`.doctor-probe-${pid}`), removed in `finally`.
 *   - No telemetry.
 *   - D11 only: optional localhost HTTP probe to Ollama `/api/tags`
 *     (P0-1 truth gap — no generation, routing, or model selection).
 */
import type { DiagnosticRecord } from "../../diagnostics/types.js";
import type { OllamaProbeOutcome } from "./ollama-probe.js";
import { type ProviderVisibilitySnapshot } from "./provider-visibility.js";
export declare const MIN_NODE_MAJOR = 20;
export declare const DOCTOR_DISCLAIMER_LINES: readonly ["Doctor checks environment readiness only. It does not validate workflow specs,", "approve changes, or grant permission to execute. Passing checks does not mean", "a workflow is safe to run without your explicit approval."];
export type DoctorSeverity = "ok" | "warn" | "fail" | "info";
export type DoctorCheckResult = {
    readonly id: string;
    readonly severity: DoctorSeverity;
    readonly label: string;
    readonly detail: string;
};
export type DoctorProbeContext = {
    readonly nodeVersion: string;
    readonly packageVersion: string | null;
    readonly storeDir: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly pid: number;
};
export type DoctorCheckOptions = Partial<DoctorProbeContext> & {
    /** Injected by CLI after `probeOllamaReachable`; defaults to not_configured in pure tests. */
    readonly ollamaProbe?: OllamaProbeOutcome;
    /** Injected for render; defaults via env in CLI when omitted. */
    readonly providerVisibility?: ProviderVisibilitySnapshot;
    /** Workflow Health diagnostics record (observe-only). */
    readonly workflowHealth?: DiagnosticRecord;
};
/** Advanced override for tests / operators; not advertised in v1 help text. */
export declare function resolveDoctorStoreDir(env?: Readonly<Record<string, string | undefined>>): string;
/** Same manifest walk as `usesteady --version`. */
export declare function resolveUseSteadyPackageVersion(startDir?: string): string | null;
/** D5 probe only. Returns true when writable. Never throws. */
export declare function probeStoreWritable(storeDir: string, pid: number): boolean;
export declare function runDoctorChecks(options?: DoctorCheckOptions): readonly DoctorCheckResult[];
export declare function summarizeDoctorChecks(checks: readonly DoctorCheckResult[]): {
    ok: number;
    warn: number;
    fail: number;
};
export declare function renderDoctorText(checks: readonly DoctorCheckResult[], options?: DoctorCheckOptions): string;
export declare function renderDoctorHelpText(): string;
//# sourceMappingURL=doctor.d.ts.map