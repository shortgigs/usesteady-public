// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/github-issues.ts
 *
 * Thin GitHub REST API client used by the friction admin reviewer.
 * All operations target the collection repo configured in FrictionConfig.
 */
// ─── Helpers ──────────────────────────────────────────────────────────────────
function ghHeaders(token) {
    return {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "usesteady/friction-reviewer",
    };
}
async function ghFetch(url, token, init = {}) {
    const resp = await fetch(url, {
        ...init,
        headers: { ...ghHeaders(token), ...(init.headers ?? {}) },
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`GitHub API ${resp.status} ${resp.url}: ${text}`);
    }
    return resp;
}
// ─── Read ─────────────────────────────────────────────────────────────────────
/**
 * Fetch all open issues labelled `status/pending` from the collection repo.
 * Pages up to 200 issues (2 pages of 100).
 */
export async function fetchPendingIssues(repo, token) {
    const issues = [];
    for (let page = 1; page <= 2; page++) {
        const url = `https://api.github.com/repos/${repo}/issues?labels=status%2Fpending&state=open&per_page=100&page=${page}`;
        const resp = await ghFetch(url, token);
        const batch = await resp.json();
        issues.push(...batch);
        if (batch.length < 100)
            break;
    }
    return issues;
}
// ─── Write ────────────────────────────────────────────────────────────────────
/** Post a comment to an issue. */
export async function postComment(repo, issueNum, body, token) {
    await ghFetch(`https://api.github.com/repos/${repo}/issues/${issueNum}/comments`, token, { method: "POST", body: JSON.stringify({ body }) });
}
/**
 * Remove `removeLabel` from an issue and add `addLabel`.
 * Silently ignores 404 on remove (label may already be absent).
 */
export async function swapLabel(repo, issueNum, removeLabel, addLabel, token) {
    // Add new label
    await ghFetch(`https://api.github.com/repos/${repo}/issues/${issueNum}/labels`, token, { method: "POST", body: JSON.stringify({ labels: [addLabel] }) });
    // Remove old label (ignore 404 if already missing)
    const delUrl = `https://api.github.com/repos/${repo}/issues/${issueNum}/labels/${encodeURIComponent(removeLabel)}`;
    const delResp = await fetch(delUrl, { method: "DELETE", headers: ghHeaders(token) });
    if (!delResp.ok && delResp.status !== 404) {
        const text = await delResp.text().catch(() => delResp.statusText);
        throw new Error(`GitHub API ${delResp.status} on label delete: ${text}`);
    }
}
/** Close an issue (used when rejecting a friction report). */
export async function closeIssue(repo, issueNum, token) {
    await ghFetch(`https://api.github.com/repos/${repo}/issues/${issueNum}`, token, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) });
}
// ─── Issue body parser ────────────────────────────────────────────────────────
/**
 * Extract the structured metadata JSON block from an issue body.
 * Returns null if the body doesn't contain a parseable block.
 */
export function parseIssueMetadata(body) {
    try {
        const match = body.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (!match?.[1])
            return null;
        return JSON.parse(match[1]);
    }
    catch {
        return null;
    }
}
/**
 * Extract the submitter email stored in the HTML comment added by the web form.
 * Format:  <!-- submitter-email: user@example.com -->
 * Returns null if absent (e.g. CLI-submitted reports).
 */
export function parseSubmitterEmail(body) {
    const match = body.match(/<!--\s*submitter-email:\s*([^\s>]+)\s*-->/i);
    return match?.[1]?.trim() ?? null;
}
/**
 * Extract the plain-text context lines from the issue body.
 * Returns an object with the human-readable fields.
 */
export function parseIssueContext(body) {
    const kindMatch = body.match(/\*\*Type:\*\*\s*(.+)/);
    const phaseMatch = body.match(/\*\*Phase:\*\*\s*(.+)/);
    const failMatch = body.match(/\*\*Failure note:\*\*\s*(.+)/);
    const notesMatch = body.match(/### Notes from reporter\s+\n+([\s\S]+?)\n+###/);
    // Task inputs: each line after "- **Task inputs:**" that starts with "  - "
    const taskSection = body.match(/\*\*Task inputs:\*\*\n((?:  - .+\n?)+)/);
    const taskSection1 = taskSection?.[1];
    const taskInputs = taskSection1
        ? taskSection1.split("\n").map(l => l.replace(/^  - /, "").trim()).filter(Boolean)
        : undefined;
    const result = {};
    const kind = kindMatch?.[1]?.trim();
    const phase = phaseMatch?.[1]?.trim();
    const failureNote = failMatch?.[1]?.trim();
    const notes = notesMatch?.[1]?.trim();
    if (kind !== undefined)
        result.kind = kind;
    if (phase !== undefined)
        result.phase = phase;
    if (failureNote !== undefined)
        result.failureNote = failureNote;
    if (taskInputs !== undefined)
        result.taskInputs = taskInputs;
    if (notes !== undefined)
        result.notes = notes;
    return result;
}
//# sourceMappingURL=github-issues.js.map