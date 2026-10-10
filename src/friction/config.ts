// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/config.ts
 *
 * Reads and writes ~/.usesteady/config.json and ~/.usesteady/auth.json.
 *
 * These files hold the configurable collection endpoint and the GitHub
 * OAuth token. Neither the endpoint URL nor the token is hardcoded in
 * the public source — users (and alpha testers) receive them out-of-band.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join }    from "node:path";
import type { AuthToken, FrictionConfig } from "./types.js";
import { DEFAULT_FRICTION_CONFIG }        from "./types.js";

const USESTEADY_DIR  = join(homedir(), ".usesteady");
const CONFIG_PATH    = join(USESTEADY_DIR, "config.json");
const AUTH_PATH      = join(USESTEADY_DIR, "auth.json");

function ensureDir(): void {
  if (!existsSync(USESTEADY_DIR)) mkdirSync(USESTEADY_DIR, { recursive: true });
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function readConfig(): FrictionConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as FrictionConfig;
    }
  } catch { /* fall through to default */ }
  return DEFAULT_FRICTION_CONFIG;
}

export function writeConfig(config: FrictionConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// ─── Auth token ───────────────────────────────────────────────────────────────

export function readAuth(): AuthToken | null {
  try {
    if (existsSync(AUTH_PATH)) {
      return JSON.parse(readFileSync(AUTH_PATH, "utf-8")) as AuthToken;
    }
  } catch { /* no token */ }
  return null;
}

export function writeAuth(token: AuthToken): void {
  ensureDir();
  writeFileSync(AUTH_PATH, JSON.stringify(token, null, 2), "utf-8");
}

export function clearAuth(): void {
  ensureDir();
  if (existsSync(AUTH_PATH)) {
    writeFileSync(AUTH_PATH, "{}", "utf-8");
  }
}
