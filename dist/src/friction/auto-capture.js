// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/auto-capture.ts
 *
 * Automatic friction event capture hooks for the server layer.
 *
 * These functions are the only integration points between the core
 * workflow domain and the friction pipeline. They must be:
 *  - Synchronous (no awaiting — never block the HTTP response path)
 *  - Zero-authority (read-only access to run state)
 *  - Silent on failure (errors logged to stderr, never rethrown)
 *
 * Called from server.ts after state-mutating actions.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { enqueue } from "./queue.js";
import { scheduleFlush } from "./client.js";
import { readConfig } from "./config.js";
// ─── Version helper ───────────────────────────────────────────────────────────
let _version = null;
function packageVersion() {
    if (_version)
        return _version;
    try {
        // Walk up from dist/src/friction/ or src/friction/ to find package.json
        const candidates = [
            join(process.cwd(), "package.json"),
        ];
        for (const p of candidates) {
            if (existsSync(p)) {
                const pkg = JSON.parse(readFileSync(p, "utf-8"));
                _version = pkg.version ?? "unknown";
                return _version;
            }
        }
    }
    catch { /* ignore */ }
    _version = "unknown";
    return _version;
}
// ─── Terminal phase capture ───────────────────────────────────────────────────
/**
 * Call this after every workflow run that has reached a terminal phase
 * (task_failed, stopped, skipped_by_intake).
 *
 * Enqueues a "workflow-failure" friction event and schedules a flush.
 * Never throws — any error is written to stderr and silently dropped.
 */
export function captureWorkflowFailure(run, workspaceRoot) {
    const failurePhasess = new Set([
        "task_failed",
        "stopped",
    ]);
    // Also capture completed runs that have skipped_by_intake tasks
    const hasSkippedByIntake = run.tasks.some((t) => t.outcome === "skipped_by_intake");
    const isCapturable = failurePhasess.has(run.phase) ||
        (run.phase === "completed" && hasSkippedByIntake);
    if (!isCapturable)
        return;
    try {
        const kind = run.phase === "stopped" ? "workflow-failure" : "workflow-failure";
        const taskInputs = run.tasks.map((t) => t.spec.input);
        // Find the first failed/skipped task for the failure note
        const failedTask = run.tasks.find((t) => t.outcome === "rejected" ||
            t.outcome === "stopped" ||
            t.outcome === "skipped_by_intake");
        const context = {
            runId: run.workflowRunId,
            phase: run.phase,
            taskInputs,
            platform: process.platform,
            nodeVersion: process.version,
            ...(failedTask ? {
                failureNote: `Task "${failedTask.spec.input.slice(0, 80)}" — outcome: ${failedTask.outcome}`,
            } : {}),
            ...(workspaceRoot ? { workspaceRoot } : {}),
        };
        enqueue({
            kind,
            capturedAt: new Date().toISOString(),
            usesteadyVersion: packageVersion(),
            context,
        });
        // Schedule flush — non-blocking, runs after current tick
        scheduleFlush(readConfig());
    }
    catch (err) {
        process.stderr.write(`[friction-capture] captureWorkflowFailure error: ${String(err)}\n`);
    }
}
/**
 * Call this from an Express error middleware to capture server-side errors.
 * The middleware should be registered AFTER all routes in server.ts.
 */
export function captureServerError(err, route) {
    try {
        enqueue({
            kind: "server-error",
            capturedAt: new Date().toISOString(),
            usesteadyVersion: packageVersion(),
            context: {
                errorMessage: err.message,
                route,
                platform: process.platform,
                nodeVersion: process.version,
                ...(err.stack ? { errorStack: err.stack.slice(0, 1000) } : {}),
            },
        });
        scheduleFlush(readConfig());
    }
    catch (captureErr) {
        process.stderr.write(`[friction-capture] captureServerError error: ${String(captureErr)}\n`);
    }
}
/**
 * Enqueue a user-initiated friction report (from UI or CLI).
 * Called with pre-built context from the UI report modal or `usesteady report`.
 */
export function captureManualReport(opts) {
    return enqueue({
        kind: opts.kind,
        capturedAt: new Date().toISOString(),
        usesteadyVersion: packageVersion(),
        notes: opts.notes,
        context: {
            platform: process.platform,
            nodeVersion: process.version,
            ...opts.context,
        },
    });
}
//# sourceMappingURL=auto-capture.js.map