/**
 * Assemble diagnostic record from observations (read-only pipeline).
 */
import type { DiagnosticRecord } from "./types.js";
export declare function buildWorkflowHealthDiagnosticRecordSync(input?: {
    env?: NodeJS.ProcessEnv;
    cachePath?: string;
    now?: Date;
    diagnostic_id?: string;
    run_at?: string;
}): DiagnosticRecord;
export declare function buildWorkflowHealthDiagnosticRecord(input?: {
    env?: NodeJS.ProcessEnv;
    cachePath?: string;
    probeIssuer?: boolean;
    now?: Date;
    fetchImpl?: typeof fetch;
    diagnostic_id?: string;
    run_at?: string;
}): Promise<DiagnosticRecord>;
//# sourceMappingURL=build.d.ts.map