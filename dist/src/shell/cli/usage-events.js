/**
 * usage-events.jsonl — append-only local usage substrate (P2).
 *
 * Materialized from existing UCP store + consensus-audit.jsonl only.
 * No execution-path writes. No billing authority.
 *
 * D12 boundary (locked):
 *   Usage summary reports observed usage only.
 *   Tokens and cost are displayed only when directly recorded in existing
 *   artifacts or provider responses.
 *   No synthetic token estimation. No pricing tables. No cost inference.
 *   No retroactive reconstruction. Unknown is authoritative.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getWorkflowAuditRecord, getWorkflowHistories } from "../../history/workflow-history.js";
import { resolveStoreDir } from "../defaults.js";
export const USAGE_EVENT_SCHEMA = "usage-event.v1";
export const USAGE_EVENTS_FILENAME = "usage-events.jsonl";
/** Exported for tests — D12 invariant text must not drift. */
export const USAGE_D12_BOUNDARY = [
    "Usage summary reports observed usage only.",
    "Tokens and cost are displayed only when directly recorded in existing artifacts.",
    "No synthetic token estimation. No pricing tables. No cost inference.",
    "No retroactive reconstruction. Unknown is authoritative.",
];
export function usageEventsPath(storeDir = resolveStoreDir()) {
    return join(storeDir, USAGE_EVENTS_FILENAME);
}
function normalizeUsageEvent(parsed) {
    if (parsed["schemaVersion"] !== USAGE_EVENT_SCHEMA)
        return null;
    if (typeof parsed["eventId"] !== "string")
        return null;
    if (parsed["eventType"] !== "workflow_run" && parsed["eventType"] !== "provider_call")
        return null;
    const legacyTokens = parsed["estimatedTokens"];
    const legacyCost = parsed["approxCostUsd"];
    const recordedTokens = parsed["recordedTokens"] ?? legacyTokens ?? null;
    const recordedCostUsd = parsed["recordedCostUsd"] ?? legacyCost ?? null;
    return {
        schemaVersion: USAGE_EVENT_SCHEMA,
        eventId: parsed["eventId"],
        eventType: parsed["eventType"],
        recordedAt: typeof parsed["recordedAt"] === "string" ? parsed["recordedAt"] : "",
        ...(typeof parsed["workflowRunId"] === "string"
            ? { workflowRunId: parsed["workflowRunId"] }
            : {}),
        ...(typeof parsed["taskIndex"] === "number"
            ? { taskIndex: parsed["taskIndex"] }
            : {}),
        ...(typeof parsed["provider"] === "string"
            ? { provider: parsed["provider"] }
            : {}),
        ...(typeof parsed["observedPluginName"] === "string"
            ? { observedPluginName: parsed["observedPluginName"] }
            : {}),
        callCount: typeof parsed["callCount"] === "number" ? parsed["callCount"] : 1,
        recordedTokens: typeof recordedTokens === "number" ? recordedTokens : null,
        recordedCostUsd: typeof recordedCostUsd === "number" ? recordedCostUsd : null,
    };
}
export function readUsageEvents(storeDir = resolveStoreDir()) {
    const path = usageEventsPath(storeDir);
    if (!existsSync(path))
        return [];
    const content = readFileSync(path, "utf-8");
    const events = [];
    for (const line of content.split("\n")) {
        if (line.trim().length === 0)
            continue;
        try {
            const parsed = JSON.parse(line);
            const event = normalizeUsageEvent(parsed);
            if (event !== null)
                events.push(event);
        }
        catch {
            /* skip malformed lines */
        }
    }
    return Object.freeze(events);
}
function loadKnownEventIds(events) {
    return new Set(events.map((e) => e.eventId));
}
/** D12: only read numeric token/cost fields explicitly present on a source object. */
export function readRecordedUsageFields(source) {
    const tokenCandidates = [
        source["recordedTokens"],
        source["inputTokens"],
        source["outputTokens"],
        source["totalTokens"],
    ];
    const costCandidates = [
        source["recordedCostUsd"],
        source["costUsd"],
        source["approxCostUsd"],
    ];
    let recordedTokens = null;
    for (const value of tokenCandidates) {
        if (typeof value === "number" && Number.isFinite(value)) {
            recordedTokens = value;
            break;
        }
    }
    let recordedCostUsd = null;
    for (const value of costCandidates) {
        if (typeof value === "number" && Number.isFinite(value)) {
            recordedCostUsd = value;
            break;
        }
    }
    return { recordedTokens, recordedCostUsd };
}
function mapObservedConsensusPlugin(pluginName) {
    if (pluginName === "claude")
        return "anthropic";
    if (pluginName === "openai-compatible")
        return "openai-compatible";
    if (pluginName === "openai")
        return "openai";
    if (pluginName === "xai")
        return "xai";
    return null;
}
function hasObservedClaudeDelivery(session) {
    if (session === null)
        return false;
    return session.claudeHandoff !== null
        || session.claudeReceipt !== null
        || session.claudeRefused !== null;
}
function providerCallEvent(partial, recordedAt, source = {}) {
    const usage = readRecordedUsageFields(source);
    return {
        schemaVersion: USAGE_EVENT_SCHEMA,
        recordedAt,
        callCount: 1,
        recordedTokens: usage.recordedTokens,
        recordedCostUsd: usage.recordedCostUsd,
        ...partial,
    };
}
function parseConsensusAuditLines(content) {
    const records = [];
    for (const line of content.split("\n")) {
        if (line.trim().length === 0)
            continue;
        try {
            const stripped = line.startsWith("[consensus-audit] ")
                ? line.slice("[consensus-audit] ".length)
                : line;
            const parsed = JSON.parse(stripped);
            if (parsed && typeof parsed.requestId === "string" && Array.isArray(parsed.rounds)) {
                records.push(parsed);
            }
        }
        catch {
            /* skip malformed */
        }
    }
    return records;
}
/** Derive new events from store; append only ids not already present. Returns count appended. */
export function materializeUsageEvents(storeDir = resolveStoreDir()) {
    const existing = readUsageEvents(storeDir);
    const knownIds = loadKnownEventIds(existing);
    const recordedAt = new Date().toISOString();
    const pending = [];
    for (const summary of getWorkflowHistories(storeDir)) {
        const runEventId = `run:${summary.workflowRunId}`;
        if (!knownIds.has(runEventId)) {
            pending.push({
                schemaVersion: USAGE_EVENT_SCHEMA,
                eventId: runEventId,
                eventType: "workflow_run",
                recordedAt,
                workflowRunId: summary.workflowRunId,
                callCount: 1,
                recordedTokens: null,
                recordedCostUsd: null,
            });
            knownIds.add(runEventId);
        }
        const audit = getWorkflowAuditRecord(storeDir, summary.workflowRunId);
        if (audit === null)
            continue;
        for (const task of audit.tasks) {
            if (!hasObservedClaudeDelivery(task.session))
                continue;
            const eventId = `task:${summary.workflowRunId}:${String(task.taskIndex)}`;
            if (knownIds.has(eventId))
                continue;
            pending.push(providerCallEvent({
                eventId,
                eventType: "provider_call",
                workflowRunId: summary.workflowRunId,
                taskIndex: task.taskIndex,
                provider: "anthropic",
                observedPluginName: "claude",
            }, recordedAt));
            knownIds.add(eventId);
        }
    }
    const consensusPath = join(storeDir, "consensus-audit.jsonl");
    if (existsSync(consensusPath)) {
        const consensusContent = readFileSync(consensusPath, "utf-8");
        for (const record of parseConsensusAuditLines(consensusContent)) {
            for (const round of record.rounds) {
                const provider = mapObservedConsensusPlugin(round.pluginName);
                if (provider === null)
                    continue;
                const eventId = `consensus:${record.requestId}:${String(round.roundNumber)}:${round.pluginName}`;
                if (knownIds.has(eventId))
                    continue;
                pending.push(providerCallEvent({
                    eventId,
                    eventType: "provider_call",
                    provider,
                    observedPluginName: round.pluginName,
                }, recordedAt, round));
                knownIds.add(eventId);
            }
        }
    }
    if (pending.length === 0)
        return 0;
    const path = usageEventsPath(storeDir);
    const payload = pending.map((e) => JSON.stringify(e)).join("\n") + "\n";
    appendFileSync(path, payload, { encoding: "utf-8", flag: "a" });
    return pending.length;
}
export function aggregateUsageSummary(events) {
    let runs = 0;
    let providerCalls = 0;
    let tokenSum = 0;
    let tokenKnown = true;
    let costSum = 0;
    let costKnown = true;
    let providerCallEvents = 0;
    const providerDistribution = {
        anthropic: 0,
        "openai-compatible": 0,
        openai: 0,
        xai: 0,
    };
    for (const event of events) {
        if (event.eventType === "workflow_run") {
            runs += event.callCount;
            continue;
        }
        if (event.eventType !== "provider_call" || event.provider === undefined)
            continue;
        providerCallEvents += 1;
        providerCalls += event.callCount;
        providerDistribution[event.provider] += event.callCount;
        if (event.recordedTokens === null) {
            tokenKnown = false;
        }
        else if (tokenKnown) {
            tokenSum += event.recordedTokens;
        }
        if (event.recordedCostUsd === null) {
            costKnown = false;
        }
        else if (costKnown) {
            costSum += event.recordedCostUsd;
        }
    }
    if (providerCallEvents === 0) {
        tokenKnown = false;
        costKnown = false;
    }
    return {
        runs,
        providerCalls,
        recordedTokens: tokenKnown ? tokenSum : null,
        recordedCostUsd: costKnown ? costSum : null,
        providerDistribution,
    };
}
export function formatUsageInteger(value) {
    return value.toLocaleString("en-US");
}
export function formatRecordedCostUsd(value) {
    if (value === null)
        return "unknown";
    return `$${value.toFixed(2)}`;
}
export function formatRecordedTokens(value) {
    if (value === null)
        return "unknown";
    return formatUsageInteger(value);
}
export function renderUsageSummaryText(summary) {
    const lines = [
        "",
        "  Usage summary:",
        `  Runs: ${formatUsageInteger(summary.runs)}`,
        `  Provider calls: ${formatUsageInteger(summary.providerCalls)}`,
        `  Recorded tokens: ${formatRecordedTokens(summary.recordedTokens)}`,
        `  Recorded cost: ${formatRecordedCostUsd(summary.recordedCostUsd)}`,
        "  Provider distribution (observed):",
        `    Anthropic: ${formatUsageInteger(summary.providerDistribution.anthropic)}`,
        `    OpenAI-compatible: ${formatUsageInteger(summary.providerDistribution["openai-compatible"])}`,
        `    OpenAI: ${formatUsageInteger(summary.providerDistribution.openai)}`,
        `    xAI: ${formatUsageInteger(summary.providerDistribution.xai)}`,
        "",
        "  Tokens and cost are unknown unless directly recorded in store artifacts.",
        "",
    ];
    return lines.join("\n");
}
//# sourceMappingURL=usage-events.js.map