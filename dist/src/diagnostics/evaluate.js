/**
 * Pure diagnostic evaluator — no I/O (INV-DIAG-IMPL-1, INV-DIAG-IMPL-4).
 */
import { suggestedActionForCode } from "./suggested-actions.js";
const CLASS_ORDER = {
    identity: 0,
    billing: 1,
    entitlement: 2,
    portal: 3,
    runtime: 4,
};
export function sortObservations(observations) {
    return [...observations].sort((a, b) => {
        const byClass = CLASS_ORDER[a.class] - CLASS_ORDER[b.class];
        if (byClass !== 0)
            return byClass;
        return a.code.localeCompare(b.code);
    });
}
export function computeOverall(observations) {
    if (observations.some((o) => o.severity === "error"))
        return "error";
    if (observations.some((o) => o.severity === "warn"))
        return "warn";
    return "healthy";
}
export function collectSuggestedActions(observations) {
    const seen = new Set();
    const out = [];
    for (const obs of sortObservations(observations)) {
        if (obs.severity !== "warn" && obs.severity !== "error")
            continue;
        const action = suggestedActionForCode(obs.code);
        if (seen.has(action))
            continue;
        seen.add(action);
        out.push(action);
    }
    return out;
}
export function evaluateDiagnosticRecord(input) {
    const observations = sortObservations(input.observations);
    const overall = computeOverall(observations);
    const record = {
        diagnostic_id: input.diagnostic_id,
        run_at: input.run_at,
        overall,
        observations,
        suggested_actions: collectSuggestedActions(observations),
        lineage: input.lineage ?? [{ at: input.run_at, kind: "run", outcome: "completed" }],
    };
    if (input.effective_state !== undefined) {
        return { ...record, effective_state: input.effective_state };
    }
    return record;
}
/** Stable fingerprint for tests (INV-DIAG-IMPL-5) — excludes run_at and diagnostic_id. */
export function diagnosticRecordFingerprint(record) {
    const payload = {
        overall: record.overall,
        observations: record.observations.map((o) => ({
            class: o.class,
            code: o.code,
            severity: o.severity,
            message: o.message,
        })),
        suggested_actions: record.suggested_actions,
        effective_state: record.effective_state ?? null,
    };
    return JSON.stringify(payload);
}
//# sourceMappingURL=evaluate.js.map