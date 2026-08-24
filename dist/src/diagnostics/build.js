/**
 * Assemble diagnostic record from observations (read-only pipeline).
 */
import { randomUUID } from "node:crypto";
import { evaluateDiagnosticRecord } from "./evaluate.js";
import { collectLocalObservations, collectObservations } from "./observe.js";
export function buildWorkflowHealthDiagnosticRecordSync(input) {
    const runAt = input?.run_at ?? new Date().toISOString();
    const { observations, effective } = collectLocalObservations(input?.env ?? process.env, input?.cachePath, input?.now);
    return evaluateDiagnosticRecord({
        diagnostic_id: input?.diagnostic_id ?? randomUUID(),
        run_at: runAt,
        observations,
        effective_state: effective,
    });
}
export async function buildWorkflowHealthDiagnosticRecord(input) {
    const runAt = input?.run_at ?? new Date().toISOString();
    if (!input?.probeIssuer) {
        return buildWorkflowHealthDiagnosticRecordSync({
            ...(input?.env !== undefined ? { env: input.env } : {}),
            ...(input?.cachePath !== undefined ? { cachePath: input.cachePath } : {}),
            ...(input?.now !== undefined ? { now: input.now } : {}),
            ...(input?.diagnostic_id !== undefined ? { diagnostic_id: input.diagnostic_id } : {}),
            run_at: runAt,
        });
    }
    const { observations, effective } = await collectObservations({
        ...(input?.env !== undefined ? { env: input.env } : {}),
        ...(input?.cachePath !== undefined ? { cachePath: input.cachePath } : {}),
        probeIssuer: true,
        ...(input?.now !== undefined ? { now: input.now } : {}),
        ...(input?.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    });
    return evaluateDiagnosticRecord({
        diagnostic_id: input?.diagnostic_id ?? randomUUID(),
        run_at: runAt,
        observations,
        effective_state: effective,
    });
}
//# sourceMappingURL=build.js.map