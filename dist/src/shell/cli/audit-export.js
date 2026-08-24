/**
 * usesteady audit export — read-only workflow run export bundle.
 *
 * P0-3: exports existing UCP store fields only. Zero authority — no
 * enforcement, signing, encryption, or store mutation.
 *
 * D2 boundary: `tasks`/`timeline` are SessionChain-derived (WorkflowAuditRecord
 * + timeline projection). `artifacts` are RunTimeline-derived (getTimeline per
 * intentId). Separate top-level arrays — never merged into one chain.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getByType } from "../../ucp/persistence/index.js";
import { getTimeline } from "../../ucp/persistence/query.js";
import { getWorkflowAuditRecord } from "../../history/workflow-history.js";
import { projectTimelineView } from "../../history/timeline-projection.js";
import { resolveStoreDir } from "../defaults.js";
/** Advanced override for tests; not advertised in v1 help text. */
export function resolveAuditExportStoreDir(env = process.env) {
    return resolveStoreDir(env);
}
export function parseAuditExportArgs(argv, outputMode) {
    if (argv.includes("--help") || argv.includes("-h")) {
        return { mode: "help" };
    }
    if (argv[0] !== "export") {
        return "usage-error";
    }
    let runId;
    for (let i = 1; i < argv.length; i += 1) {
        const tok = argv[i];
        if (tok === "--run-id") {
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("-"))
                return "usage-error";
            runId = next;
            i += 1;
            continue;
        }
        if (tok.startsWith("--run-id=")) {
            const value = tok.slice("--run-id=".length);
            if (value.length === 0)
                return "usage-error";
            runId = value;
            continue;
        }
        if (tok.startsWith("-"))
            return "usage-error";
        return "usage-error";
    }
    if (runId === undefined) {
        return "usage-error";
    }
    return {
        mode: "export",
        runId,
        output: outputMode ?? "json",
    };
}
function loadTaskInputs(storeDir, workflowRunId) {
    try {
        const envelopes = getByType(storeDir, "ucp.workflow_run.v1");
        const match = envelopes.find((env) => env.payload.workflowRunId === workflowRunId);
        if (match === undefined)
            return [];
        return match.payload.taskInputs ?? [];
    }
    catch {
        return [];
    }
}
function collectArtifacts(storeDir, audit) {
    const entries = [];
    for (const task of audit.tasks) {
        const session = task.session;
        const intentId = session?.intentId ?? null;
        if (intentId === null || intentId.length === 0)
            continue;
        const runTimeline = getTimeline(storeDir, intentId);
        entries.push({
            taskIndex: task.taskIndex,
            intentId,
            intent: runTimeline.intent,
            response: runTimeline.response,
            artifact: runTimeline.artifact,
            trace: runTimeline.trace,
            replay: runTimeline.replay,
            reminderExecution: runTimeline.reminderExecution,
        });
    }
    return entries;
}
export function buildAuditExportBundle(storeDir, runId) {
    const audit = getWorkflowAuditRecord(storeDir, runId);
    if (audit === null) {
        return { kind: "error", error: { kind: "run_not_found", runId } };
    }
    const taskInputs = loadTaskInputs(storeDir, runId);
    const timelineView = projectTimelineView(audit, taskInputs);
    const timelineRows = timelineView.kind === "run" ? timelineView.tasks : [];
    const bundle = {
        workflowRunId: audit.workflowRunId,
        workflowName: audit.workflowName,
        finalOutcome: audit.finalOutcome,
        tasks: audit.tasks,
        timeline: timelineRows,
        artifacts: collectArtifacts(storeDir, audit),
    };
    return { kind: "ok", bundle };
}
export function auditExportFilePath(runId, cwd = process.cwd()) {
    return join(cwd, "audit-exports", `${runId}.json`);
}
export function renderAuditExportJson(result) {
    if (result.kind === "error") {
        if (result.error.kind === "missing_run_id") {
            return JSON.stringify({ success: false, error: "missing_run_id" }) + "\n";
        }
        return JSON.stringify({
            success: false,
            error: "run_not_found",
            runId: result.error.runId,
        }) + "\n";
    }
    return JSON.stringify(result.bundle) + "\n";
}
export function runAuditExport(args, options = {}) {
    if (args.mode === "help") {
        return { stdout: renderAuditExportHelpText(), exitCode: 0 };
    }
    const storeDir = options.storeDir ?? resolveAuditExportStoreDir();
    const cwd = options.cwd ?? process.cwd();
    const built = buildAuditExportBundle(storeDir, args.runId);
    if (built.kind === "error") {
        return {
            stdout: renderAuditExportJson(built),
            exitCode: 1,
        };
    }
    const json = renderAuditExportJson(built);
    if (args.output === "file") {
        const filePath = auditExportFilePath(args.runId, cwd);
        mkdirSync(join(cwd, "audit-exports"), { recursive: true });
        writeFileSync(filePath, json, "utf8");
        return {
            stdout: JSON.stringify({ success: true, path: filePath }) + "\n",
            exitCode: 0,
        };
    }
    return { stdout: json, exitCode: 0 };
}
export function renderAuditExportHelpText() {
    return ("\n" +
        "  usesteady audit export — read-only workflow run export bundle\n\n" +
        "  Usage:\n" +
        "    usesteady audit export --run-id <workflowRunId>\n" +
        "    usesteady audit export --run-id <workflowRunId> --output json\n" +
        "    usesteady audit export --run-id <workflowRunId> --output file\n\n" +
        "  Exports existing store fields only. Does not execute, approve,\n" +
        "  sign, encrypt, or mutate the store.\n\n" +
        "  --output json   Write export JSON to stdout (default).\n" +
        "  --output file   Write export JSON to ./audit-exports/<run-id>.json\n\n");
}
export function renderMissingRunIdError() {
    return ("\n  Error: `audit export` requires --run-id <workflowRunId>\n" +
        "  Usage: usesteady audit export --run-id <id> [--output json|file]\n\n");
}
//# sourceMappingURL=audit-export.js.map