/**
 * usesteady timeline — read-only chronological workflow run view.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * Authority: zero. Reads UCP store via src/history/ only (+ taskInputs peel).
 */
import { getByType } from "../../ucp/persistence/index.js";
import { resolveStoreDir } from "../defaults.js";
import { getWorkflowAuditRecord, getWorkflowHistories } from "../../history/workflow-history.js";
import { projectTimelineView } from "../../history/timeline-projection.js";
import { renderTimelineJson, renderTimelineText } from "../timeline-render.js";
/** Advanced override for tests; not advertised in v1 help text. */
export function resolveTimelineStoreDir(env = process.env) {
    return resolveStoreDir(env);
}
export function parseTimelineArgs(argv) {
    let help = false;
    let last = false;
    let runId;
    for (let i = 0; i < argv.length; i += 1) {
        const tok = argv[i];
        if (tok === "--help" || tok === "-h") {
            help = true;
            continue;
        }
        if (tok === "--last") {
            last = true;
            continue;
        }
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
    if (help)
        return { mode: "help" };
    if (last && runId !== undefined)
        return "usage-error";
    if (last)
        return { mode: "last" };
    if (runId !== undefined)
        return { mode: "run-id", runId };
    return "usage-error";
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
function resolveLastRunId(storeDir) {
    const histories = getWorkflowHistories(storeDir);
    if (histories.length === 0)
        return null;
    let latest = histories[0];
    for (const h of histories) {
        if (h.ts > latest.ts)
            latest = h;
    }
    return latest.workflowRunId;
}
export function buildTimelineView(storeDir, args) {
    if (args.mode === "help") {
        throw new Error("buildTimelineView: help mode");
    }
    let runId;
    if (args.mode === "last") {
        runId = resolveLastRunId(storeDir);
        if (runId === null)
            return { kind: "empty" };
    }
    else {
        runId = args.runId;
    }
    const audit = getWorkflowAuditRecord(storeDir, runId);
    if (audit === null) {
        // K7-I1 / K7-I2: audit-null always → incomplete; no secondary artifact scans.
        return { kind: "incomplete", runId };
    }
    const taskInputs = loadTaskInputs(storeDir, runId);
    return projectTimelineView(audit, taskInputs);
}
export function runTimeline(args, storeDir = resolveTimelineStoreDir(), format = "text") {
    const view = buildTimelineView(storeDir, args);
    if (format === "json") {
        return {
            json: renderTimelineJson(view),
            exitCode: 0,
        };
    }
    return {
        text: renderTimelineText(view),
        exitCode: 0,
    };
}
//# sourceMappingURL=timeline.js.map