/**
 * P6 V1 — split executor self-report from independent outcome verification.
 *
 * Executor `accepted` is a delivery/execution report. It is never, by itself,
 * a verified-against-reality verdict. Only an independent observer
 * (`makeFsRealityProbe` on supported FS ops) may produce `agree`.
 *
 * Vocabulary is existing: RealityVerdict + pulse status. Do not invent names.
 */
/**
 * Reconcile X (executor report) with O (independent observation) into R.
 * Never rewrites X. Never promotes accepted alone. Never promotes failed+match
 * to a pulse `agree`.
 */
export function reconcileOutcome(input) {
    const { executorReport } = input;
    if (!input.observerAvailable) {
        return {
            executorReport,
            status: "unverified",
            observation: "not_observed",
        };
    }
    if (input.probeError) {
        return {
            executorReport,
            status: "unknown",
            observation: "unknown",
            realityVerdict: "unknown",
            intendedVsActual: "unknown",
            ...(input.probeDetail !== undefined ? { observationDetail: input.probeDetail } : {}),
        };
    }
    const probeVerdict = input.probeVerdict;
    if (probeVerdict === undefined) {
        return {
            executorReport,
            status: "unverified",
            observation: "not_observed",
        };
    }
    const intendedVsActual = probeVerdict === "agree" ? "match" : probeVerdict === "disagree" ? "deviation" : "unknown";
    const base = {
        executorReport,
        observation: probeVerdict,
        intendedVsActual,
        ...(input.probeDetail !== undefined ? { observationDetail: input.probeDetail } : {}),
    };
    if (executorReport === "failed") {
        // Preserve both facts. Do not rewrite the executor report into success,
        // and do not emit pulse `agree` from a failed delivery.
        return {
            ...base,
            status: "unverified",
        };
    }
    if (probeVerdict === "agree") {
        return { ...base, status: "verified", realityVerdict: "agree" };
    }
    if (probeVerdict === "disagree") {
        return { ...base, status: "disagreement", realityVerdict: "disagree" };
    }
    return { ...base, status: "unknown", realityVerdict: "unknown" };
}
export function fsChangeTargetPath(op) {
    switch (op.operationType) {
        case "create_dir":
            return op.dirPath;
        case "write_file":
        case "append_file":
        case "prepend_file":
        case "delete_file":
            return op.filePath;
        case "rename":
            return op.filePath;
        case "run_command":
            return op.command;
    }
}
/**
 * Map a workflow FS op onto the existing probe's ExecutableOperation.
 * Unsupported / opaque kinds return null — observer not available (honest).
 */
export function fsChangeToExecutableOp(op) {
    switch (op.operationType) {
        case "create_dir":
            return { kind: "create_dir", path: op.dirPath };
        case "write_file":
            return { kind: "create_file", path: op.filePath, content: op.content };
        case "delete_file":
            return {
                kind: "delete_file",
                path: op.filePath,
                // Probe verifies absence only; the pin is required by the union.
                expectedPriorSha256: "0".repeat(64),
            };
        case "append_file":
        case "prepend_file":
        case "rename":
        case "run_command":
            return null;
    }
}
export function executionPayloadForApprovedOp(op, claimedRan) {
    return {
        ranWhatWasApproved: claimedRan,
        deterministic: true,
        steps: [op.kind],
        results: [
            {
                op,
                status: claimedRan ? "ran" : "failed",
                detail: claimedRan ? "executor reported accepted" : "executor reported failed",
            },
        ],
    };
}
export function runIndependentProbe(probe, payload) {
    try {
        const result = probe(payload);
        if (result instanceof Promise) {
            throw new Error("async probe is not in the P6 V1 FS path");
        }
        return resultToTuple(result);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { verdict: "unknown", detail: message, error: true };
    }
}
function resultToTuple(result) {
    return {
        verdict: result.realityVerdict,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        error: false,
    };
}
/** R applies to X and O only when the bound ids still match. */
export function reconciliationBinds(input) {
    return (input.reconciliationExecutorReportId === input.executorReportId &&
        input.reconciliationObservationId === input.observationId);
}
//# sourceMappingURL=outcome-verification.js.map