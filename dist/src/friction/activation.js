// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/activation.ts
 *
 * Lightweight activation metric capture for the onboarding funnel.
 *
 * Three events, three numbers:
 *   onboarding_started     → user hit the first screen
 *   example_approved       → user pressed a / Enter on the example
 *   second_prompt_entered  → user typed a real request after onboarding
 *
 * Transport:
 *   1. Local JSONL  — ~/.usesteady/activation.jsonl  (always works, no auth)
 *   2. HTTP POST    — https://usesteady.dev/api/activation (fire-and-forget)
 *
 * Contract:
 *   - Never throws. All errors are silently swallowed.
 *   - Never blocks. All I/O is async and detached from the main path.
 *   - No GitHub token required. No user data. No file paths.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { capture } from "./posthog.js";
// ─── Constants ────────────────────────────────────────────────────────────────
const USESTEADY_DIR = join(homedir(), ".usesteady");
const ACTIVATION_LOG = join(USESTEADY_DIR, "activation.jsonl");
const ENDPOINT = "https://usesteady.dev/api/activation";
// ─── Version helper ───────────────────────────────────────────────────────────
let _version = null;
function packageVersion() {
    if (_version)
        return _version;
    try {
        const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
        _version = pkg.version ?? "unknown";
    }
    catch {
        _version = "unknown";
    }
    return _version;
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Generate a new onboarding session ID.
 * Call once at the start of runOnboarding() and thread through all events.
 */
export function newActivationSession() {
    return randomUUID();
}
/**
 * Capture one activation event.
 *
 * @param event     The event name.
 * @param sessionId UUID from newActivationSession() — links events from one run.
 * @param ms        Milliseconds since onboarding_started (omit for the first event).
 */
export function captureActivation(event, sessionId, ms) {
    try {
        const payload = {
            event,
            session: sessionId,
            platform: process.platform,
            nodeVersion: process.version,
            version: packageVersion(),
            ts: new Date().toISOString(),
            ...(ms !== undefined ? { ms } : {}),
        };
        const line = JSON.stringify(payload);
        // 1. Local JSONL — synchronous, always succeeds
        try {
            if (!existsSync(USESTEADY_DIR))
                mkdirSync(USESTEADY_DIR, { recursive: true });
            appendFileSync(ACTIVATION_LOG, line + "\n", "utf-8");
        }
        catch { /* disk full, permissions — ignore */ }
        // 2. Remote — fire-and-forget, never awaited, never rethrown
        fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: line,
        }).catch(() => { });
        // 3. PostHog — same payload, uses stable anon ID
        capture(event, {
            session: sessionId,
            platform: payload.platform,
            nodeVersion: payload.nodeVersion,
            version: payload.version,
            ...(ms !== undefined ? { ms } : {}),
        });
    }
    catch { /* outer safety net */ }
}
//# sourceMappingURL=activation.js.map