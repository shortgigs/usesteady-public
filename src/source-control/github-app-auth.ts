/**
 * S3b — GitHub App auth (one-time platform credentials on Core).
 *
 * Product path: App install → store installation_id → mint installation
 * access token at execute time. REJECTED: per-org Render GOVERNED_SCM_TOKEN_ORG_*.
 *
 * Env (one-time, org-count independent):
 *   USESTEADY_GITHUB_APP_ID
 *   USESTEADY_GITHUB_APP_PRIVATE_KEY  (PEM; \n escaped OK)
 * Optional:
 *   USESTEADY_GITHUB_APP_SLUG         (for Portal install URL)
 */

import { createSign, createPrivateKey } from "node:crypto";

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function readAppId(): string | null {
  const id = (process.env["USESTEADY_GITHUB_APP_ID"] ?? "").trim();
  return id.length > 0 ? id : null;
}

function readPrivateKeyPem(): string | null {
  const raw = (process.env["USESTEADY_GITHUB_APP_PRIVATE_KEY"] ?? "").trim();
  if (raw.length === 0) return null;
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

/** True when one-time App credentials are configured on Core. */
export function githubAppConfigured(): boolean {
  return readAppId() !== null && readPrivateKeyPem() !== null;
}

export function githubAppInstallUrl(state?: string): string | null {
  const slug = (process.env["USESTEADY_GITHUB_APP_SLUG"] ?? "").trim();
  if (slug.length === 0) return null;
  const base = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
  if (state && state.trim().length > 0) {
    return `${base}?state=${encodeURIComponent(state.trim())}`;
  }
  return base;
}

/**
 * Mint a short-lived GitHub App JWT (iss = app id). Never logs the key.
 */
export function mintGitHubAppJwt(nowSec: number = Math.floor(Date.now() / 1000)): string {
  const appId = readAppId();
  const pem = readPrivateKeyPem();
  if (appId === null || pem === null) {
    throw new Error("GitHub App is not configured on Core");
  }
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: nowSec - 60,
      exp: nowSec + 9 * 60,
      iss: appId,
    }),
  );
  const data = `${header}.${payload}`;
  const key = createPrivateKey(pem);
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = b64url(signer.sign(key));
  return `${data}.${sig}`;
}

export type InstallationTokenResult = {
  readonly token: string;
  readonly expiresAt: string | null;
};

/**
 * Exchange App JWT for an installation access token.
 * installation_id comes from registry (partner App install) — never from client paths.
 */
export async function mintInstallationAccessToken(
  installationId: string | number,
  deps: { readonly fetchFn?: typeof fetch; readonly apiBase?: string } = {},
): Promise<InstallationTokenResult> {
  const id = String(installationId).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error("installation_id must be numeric");
  }
  const jwt = mintGitHubAppJwt();
  const apiBase = (deps.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  const fetchFn = deps.fetchFn ?? fetch;
  const res = await fetchFn(
    `${apiBase}/app/installations/${id}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "usesteady/github-app",
      },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GitHub installation token mint failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof body.token !== "string" || body.token.trim().length === 0) {
    throw new Error("GitHub installation token response missing token");
  }
  return {
    token: body.token.trim(),
    expiresAt:
      typeof body.expires_at === "string" && body.expires_at.trim().length > 0
        ? body.expires_at.trim()
        : null,
  };
}
