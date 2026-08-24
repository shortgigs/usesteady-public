// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/client.ts
 *
 * Submits a queued friction entry to the collection backend.
 *
 * The collection endpoint and GitHub token are read from
 * ~/.usesteady/config.json and ~/.usesteady/auth.json respectively.
 * No hardcoded private URLs exist in this file — alpha testers receive
 * a pre-filled config.json out-of-band.
 *
 * Transport: GitHub Issues REST API
 *   POST /repos/{owner}/{repo}/issues
 *   Authorization: Bearer {github_token}
 *
 * The private friction collection repo has triage label
 * automation that routes + tags incoming issues automatically.
 */
import { readAuth } from "./config.js";
import { markSubmitted, markFailed, pendingEntries, pruneSubmitted, } from "./queue.js";
// ─── Issue body builder ───────────────────────────────────────────────────────
function buildIssueBody(entry, githubLogin) {
    const { event } = entry;
    const ctx = event.context;
    const contextLines = [];
    if (ctx.phase)
        contextLines.push(`- **Phase:** ${ctx.phase}`);
    if (ctx.runId)
        contextLines.push(`- **Run ID:** \`${ctx.runId}\``);
    if (ctx.taskInputs?.length) {
        contextLines.push("- **Task inputs:**");
        for (const t of ctx.taskInputs)
            contextLines.push(`  - ${t}`);
    }
    if (ctx.failureNote)
        contextLines.push(`- **Failure note:** ${ctx.failureNote}`);
    if (ctx.workspaceRoot)
        contextLines.push(`- **Workspace:** \`${ctx.workspaceRoot}\``);
    if (ctx.route)
        contextLines.push(`- **Route:** \`${ctx.route}\``);
    if (ctx.errorMessage)
        contextLines.push(`- **Error:** ${ctx.errorMessage}`);
    const metadata = {
        id: entry.id,
        kind: event.kind,
        capturedAt: event.capturedAt,
        usesteadyVersion: event.usesteadyVersion,
        platform: ctx.platform,
        nodeVersion: ctx.nodeVersion,
    };
    return [
        `## Friction Report`,
        ``,
        `**Type:** ${event.kind}`,
        `**Reporter:** @${githubLogin}`,
        `**Captured:** ${event.capturedAt}`,
        `**UseSteady version:** ${event.usesteadyVersion}`,
        ``,
        `### Context`,
        contextLines.length ? contextLines.join("\n") : "_No structured context._",
        ``,
        ...(event.notes ? [`### Notes from reporter`, ``, event.notes, ``] : []),
        `### Metadata`,
        ``,
        "```json",
        JSON.stringify(metadata, null, 2),
        "```",
    ].join("\n");
}
function buildIssueTitle(entry) {
    const { event } = entry;
    const ctx = event.context;
    switch (event.kind) {
        case "workflow-failure":
            return `[friction] workflow ${event.kind}: ${ctx.phase ?? "unknown phase"} — ${ctx.runId?.slice(0, 8) ?? "?"}`;
        case "server-error":
            return `[friction] server error: ${ctx.route ?? "unknown route"}`;
        case "ux-block":
            return `[friction] ux block: ${(event.notes ?? "").slice(0, 60) || "user report"}`;
        case "install-error":
            return `[friction] install error: ${(ctx.errorMessage ?? "").slice(0, 60) || "startup crash"}`;
        case "manual-cli":
            return `[friction] manual report: ${(event.notes ?? "").slice(0, 60) || "cli report"}`;
    }
}
/**
 * Submit one queue entry to the GitHub Issues collection backend.
 * Returns the created issue number on success, throws on failure.
 */
export async function submitEntry(entry, config) {
    const auth = readAuth();
    if (!auth?.githubToken) {
        throw new Error("No GitHub token. Run `usesteady report` and authenticate first.");
    }
    const body = {
        title: buildIssueTitle(entry),
        body: buildIssueBody(entry, auth.githubLogin),
        labels: ["status/pending", entry.event.kind],
    };
    const resp = await fetch(config.frictionEndpoint, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${auth.githubToken}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": `usesteady/${entry.event.usesteadyVersion}`,
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`GitHub API ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return data.number;
}
// ─── Flush loop ───────────────────────────────────────────────────────────────
/**
 * Flush all pending queue entries to the collection backend.
 *
 * Designed to be called:
 *  - At server startup (if a token exists)
 *  - After each new enqueue (non-blocking, fire-and-forget)
 *
 * Uses simple linear back-off between entries to avoid rate limiting.
 * Returns the count of successfully submitted entries.
 */
export async function flushQueue(config) {
    const auth = readAuth();
    if (!auth?.githubToken)
        return 0; // nothing to do without a token
    const entries = pendingEntries(20);
    if (entries.length === 0)
        return 0;
    let submitted = 0;
    for (const entry of entries) {
        try {
            await submitEntry(entry, config);
            markSubmitted(entry.id);
            submitted++;
            // Small delay between submissions — GitHub allows 5000 req/hour per token
            // but we are polite to avoid bursts.
            await new Promise((r) => setTimeout(r, 300));
        }
        catch (err) {
            markFailed(entry.id, String(err));
            process.stderr.write(`[friction-client] submission failed for ${entry.id}: ${String(err)}\n`);
        }
    }
    // Housekeeping: prune old submitted entries
    pruneSubmitted(30);
    return submitted;
}
/**
 * Fire-and-forget flush — called after enqueue() so callers don't need to await.
 */
export function scheduleFlush(config) {
    setImmediate(() => {
        flushQueue(config).catch((err) => {
            process.stderr.write(`[friction-client] flush error: ${String(err)}\n`);
        });
    });
}
//# sourceMappingURL=client.js.map