/**
 * CLI env hydration — reads `~/.usesteady/config.json` and populates
 * `process.env[envKey]` for every registered provider whose env var is
 * not already set.
 *
 * Issue: #150 — "add provider-agnostic credential pre-flight blocking".
 *
 * Why this exists
 *
 *   `src/utils/credentials.ts` is pure and only reads `process.env`. That
 *   is the right contract — but the CLI also supports the legacy config
 *   file written by `claude-setup.ts` (`~/.usesteady/config.json` with
 *   `{ "anthropic_api_key": "..." }`). Pre-existing users have their key
 *   there, not in the environment.
 *
 *   Calling `hydrateEnvFromConfig()` once at CLI entry bridges the two:
 *   the config file is loaded into `process.env` (env vars always win),
 *   after which every downstream helper — including `getMissingProviders`
 *   — sees the hydrated state consistently. Zero branching is needed in
 *   the detection layer.
 *
 * Provider-agnostic
 *
 *   The config-key convention is `<provider_id>_api_key` (snake case).
 *   `anthropic_api_key`, `openai_api_key`, etc. A tiny legacy shim reads
 *   `claude_api_key` as a fallback for Anthropic, matching what
 *   `claude-setup.ts` has always done.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join }    from "node:path";

import { PROVIDERS } from "../../config/providers.js";

const USESTEADY_DIR = join(homedir(), ".usesteady");
const CONFIG_PATH   = join(USESTEADY_DIR, "config.json");

function providerConfigKey(providerId: string): string {
  return `${providerId}_api_key`;
}

/**
 * Populate `process.env[envKey]` for each provider whose env var is unset
 * and whose key is present in `~/.usesteady/config.json`.
 *
 * Idempotent. Safe to call multiple times. Env vars already set are never
 * overwritten — env always wins over the config file.
 */
export function hydrateEnvFromConfig(): void {
  if (!existsSync(CONFIG_PATH)) return;

  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return;
  }

  for (const p of PROVIDERS) {
    if (process.env[p.envKey]) continue;

    const primary = cfg[providerConfigKey(p.id)];
    // Legacy shim: `claude_api_key` is the old name for `anthropic_api_key`.
    // Kept for pre-#150 users; no other provider has a legacy key.
    const legacy  = p.id === "anthropic" ? cfg["claude_api_key"] : undefined;
    const value   = primary ?? legacy;

    if (typeof value === "string" && value.trim().length > 0) {
      process.env[p.envKey] = value;
    }
  }
}
