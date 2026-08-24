/**
 * Pure diagnostic evaluator — no I/O (INV-DIAG-IMPL-1, INV-DIAG-IMPL-4).
 */
import type { EffectiveState } from "../shell/cli/entitlement-cache.js";
import type { DiagnosticObservation, DiagnosticOverall, DiagnosticRecord, DiagnosticLineageEntry } from "./types.js";
export declare function sortObservations(observations: readonly DiagnosticObservation[]): DiagnosticObservation[];
export declare function computeOverall(observations: readonly DiagnosticObservation[]): DiagnosticOverall;
export declare function collectSuggestedActions(observations: readonly DiagnosticObservation[]): string[];
export declare function evaluateDiagnosticRecord(input: {
    diagnostic_id: string;
    run_at: string;
    observations: readonly DiagnosticObservation[];
    effective_state?: EffectiveState;
    lineage?: readonly DiagnosticLineageEntry[];
}): DiagnosticRecord;
/** Stable fingerprint for tests (INV-DIAG-IMPL-5) — excludes run_at and diagnostic_id. */
export declare function diagnosticRecordFingerprint(record: DiagnosticRecord): string;
//# sourceMappingURL=evaluate.d.ts.map