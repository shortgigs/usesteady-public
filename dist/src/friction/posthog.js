// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/posthog.ts
 *
 * Thin wrapper around posthog-node for the CLI.
 *
 * Rules:
 *  - Never throws — all errors are silently swallowed
 *  - Never blocks  — flush() is called on process exit
 *  - Key is read from POSTHOG_KEY env var; if absent, all calls no-op
 *  - Distinct ID defaults to a stable anonymous UUID stored in ~/.usesteady/anon-id
 */
import { PostHog } from "posthog-node";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// ─── Singleton ────────────────────────────────────────────────────────────────
let _client = null;
function client() {
    if (_client)
        return _client;
    const key = process.env["POSTHOG_KEY"];
    if (!key)
        return null;
    _client = new PostHog(key, {
        host: "https://us.i.posthog.com",
        flushAt: 1, // send immediately in CLI (short-lived process)
        flushInterval: 0,
    });
    return _client;
}
// ─── Anonymous stable ID ──────────────────────────────────────────────────────
const USESTEADY_DIR = join(homedir(), ".usesteady");
const ANON_ID_FILE = join(USESTEADY_DIR, "anon-id");
let _anonId = null;
export function getAnonId() {
    if (_anonId)
        return _anonId;
    try {
        if (!existsSync(USESTEADY_DIR))
            mkdirSync(USESTEADY_DIR, { recursive: true });
        if (existsSync(ANON_ID_FILE)) {
            _anonId = readFileSync(ANON_ID_FILE, "utf-8").trim();
        }
        else {
            _anonId = randomUUID();
            writeFileSync(ANON_ID_FILE, _anonId, "utf-8");
        }
    }
    catch {
        _anonId = randomUUID();
    }
    return _anonId;
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Identify a real user (call when email/name becomes known, e.g. friction submit).
 * Links future anonymous events to this identity.
 */
export function identifyUser(opts) {
    try {
        const c = client();
        if (!c)
            return;
        const id = getAnonId();
        c.identify({
            distinctId: id,
            properties: {
                email: opts.email,
                ...(opts.name ? { name: opts.name } : {}),
            },
        });
    }
    catch { /* ignore */ }
}
/**
 * Capture one event.
 *
 * @param event       snake_case event name
 * @param properties  optional key/value bag
 * @param distinctId  override ID (defaults to stable anon ID)
 */
export function capture(event, properties, distinctId) {
    try {
        const c = client();
        if (!c)
            return;
        c.capture({
            distinctId: distinctId ?? getAnonId(),
            event,
            properties: properties ?? {},
        });
    }
    catch { /* ignore */ }
}
/**
 * Flush all queued events. Call before process.exit().
 */
export async function shutdown() {
    try {
        await _client?.shutdown();
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=posthog.js.map