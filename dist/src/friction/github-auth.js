// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/github-auth.ts
 *
 * GitHub Device Flow OAuth — no browser redirect needed.
 *
 * Flow:
 *  1. POST /login/device/code  → get device_code + user_code + verification_uri
 *  2. Show user_code to the user; they visit verification_uri and enter it
 *  3. Poll /login/oauth/access_token until user approves or timeout
 *  4. Exchange token for GitHub user profile
 *  5. Store token in ~/.usesteady/auth.json
 *
 * Required GitHub OAuth App settings:
 *   - Client ID: set via USESTEADY_GITHUB_CLIENT_ID env var or ~/.usesteady/config.json
 *   - Scopes: user:email (read public profile + email)
 *   - Device flow: enabled in GitHub App / OAuth App settings
 *
 * Register a free GitHub OAuth App at:
 *   https://github.com/settings/developers → "New OAuth App"
 *   Set Authorization callback URL to: http://localhost (unused for device flow)
 *   Enable "Device Authorization flow" checkbox
 */
import { writeAuth } from "./config.js";
// ─── GitHub OAuth endpoints ────────────────────────────────────────────────────
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
// The client ID for the UseSteady GitHub OAuth App.
// Alpha testers either have this set via env var or it ships in their config.
function getClientId() {
    const fromEnv = process.env["USESTEADY_GITHUB_CLIENT_ID"];
    if (fromEnv)
        return fromEnv;
    throw new Error("USESTEADY_GITHUB_CLIENT_ID is not set.\n" +
        "Set it in your environment or run: usesteady report --setup");
}
// ─── Step 1: Request device code ──────────────────────────────────────────────
async function requestDeviceCode() {
    const resp = await fetch(GITHUB_DEVICE_CODE_URL, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_id: getClientId(),
            scope: "user:email",
        }),
    });
    if (!resp.ok) {
        throw new Error(`Device code request failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
}
// ─── Step 2: Poll for token ───────────────────────────────────────────────────
async function pollForToken(deviceCode, intervalSec, expiresInSec, onWaiting) {
    const deadline = Date.now() + expiresInSec * 1000;
    const intervalMs = Math.max(intervalSec, 5) * 1000;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        const resp = await fetch(GITHUB_TOKEN_URL, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: getClientId(),
                device_code: deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
        });
        const data = await resp.json();
        if (data.access_token) {
            return data.access_token;
        }
        if (data.error === "authorization_pending") {
            onWaiting?.();
            continue;
        }
        if (data.error === "slow_down") {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
        }
        if (data.error === "expired_token") {
            throw new Error("Device code expired. Run `usesteady report` again.");
        }
        if (data.error === "access_denied") {
            throw new Error("Authorization denied by user.");
        }
        throw new Error(`Unexpected error: ${data.error ?? "unknown"} — ${data.error_description ?? ""}`);
    }
    throw new Error("Authorization timed out. Run `usesteady report` again.");
}
// ─── Step 3: Fetch user profile ───────────────────────────────────────────────
async function fetchUserProfile(token) {
    const [userResp, emailsResp] = await Promise.all([
        fetch(GITHUB_USER_URL, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "usesteady",
            },
        }),
        fetch(GITHUB_EMAILS_URL, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "usesteady",
            },
        }),
    ]);
    const user = await userResp.json();
    let email = user.email ?? undefined;
    if (emailsResp.ok) {
        const emails = await emailsResp.json();
        const primary = emails.find((e) => e.primary && e.verified);
        if (primary)
            email = primary.email;
    }
    return { login: user.login, ...(email ? { email } : {}) };
}
// ─── Public: run the full device flow ────────────────────────────────────────
/**
 * Run the GitHub device-flow OAuth dance interactively.
 *
 * Prints the user code and verification URL to stdout, then polls
 * until the user approves. Stores the resulting token in
 * ~/.usesteady/auth.json and returns the AuthToken.
 *
 * @param onCode   called with { userCode, verificationUri } when ready to display
 * @param onWaiting called each poll cycle while waiting for user
 */
export async function runDeviceFlow(opts) {
    const codeResp = await requestDeviceCode();
    opts?.onCode?.({
        userCode: codeResp.user_code,
        verificationUri: codeResp.verification_uri,
    });
    const token = await pollForToken(codeResp.device_code, codeResp.interval, codeResp.expires_in, opts?.onWaiting);
    const { login, email } = await fetchUserProfile(token);
    const authToken = {
        githubToken: token,
        githubLogin: login,
        obtainedAt: new Date().toISOString(),
        ...(email ? { githubEmail: email } : {}),
    };
    writeAuth(authToken);
    return authToken;
}
//# sourceMappingURL=github-auth.js.map