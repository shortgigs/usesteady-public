/**
 * W-W1 — Server-side workspace registry (INV-WS-1).
 *
 * Maps opaque `workspace_key` values to server-bound sandbox roots and optional
 * SCM actuation config. Loaded at boot from GOVERNED_WORKSPACE_REGISTRY_FILE
 * (durable) or GOVERNED_WORKSPACE_REGISTRY (inline JSON / legacy path).
 * Request bodies never supply paths or repo coordinates.
 *
 * Durability (prod): prefer REGISTRY_FILE on a persistent volume (Render /data).
 * Merge preserves GitHub App installationId when re-binding the same owner/repo
 * without re-sending the id (partners must not re-install after every redeploy).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type WorkspaceScmConfig = {
  readonly provider: "github" | "gitlab";
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch?: string;
  /**
   * GitHub App installation id (S3b product path).
   * Core mints installation access tokens at execute time.
   */
  readonly installationId?: string;
  readonly apiBase?: string;
};

export type WorkspaceRegistryEntry = {
  readonly sandboxRoot: string;
  readonly scm?: WorkspaceScmConfig;
};

export type WorkspaceRegistry = Readonly<Record<string, WorkspaceRegistryEntry>>;

let loadedRegistry: WorkspaceRegistry | null = null;

function parseRegistryJson(raw: string): WorkspaceRegistry {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GOVERNED_WORKSPACE_REGISTRY must be a JSON object");
  }
  const out: Record<string, WorkspaceRegistryEntry> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim().length === 0) continue;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`registry entry for ${key} must be an object`);
    }
    const entry = value as { sandboxRoot?: unknown; scm?: unknown };
    const sandboxRoot =
      typeof entry.sandboxRoot === "string" ? entry.sandboxRoot.trim() : "";
    if (sandboxRoot.length === 0) {
      throw new Error(`registry entry ${key} missing sandboxRoot`);
    }
    let scm: WorkspaceScmConfig | undefined;
    if (entry.scm !== undefined && entry.scm !== null) {
      if (typeof entry.scm !== "object" || Array.isArray(entry.scm)) {
        throw new Error(`registry entry ${key} scm must be an object`);
      }
      const s = entry.scm as Record<string, unknown>;
      const provider = s["provider"];
      const owner = typeof s["owner"] === "string" ? s["owner"].trim() : "";
      const repo = typeof s["repo"] === "string" ? s["repo"].trim() : "";
      if (provider !== "github" && provider !== "gitlab") {
        throw new Error(`registry entry ${key} scm.provider must be github or gitlab`);
      }
      if (owner.length === 0 || repo.length === 0) {
        throw new Error(`registry entry ${key} scm requires owner and repo`);
      }
      scm = {
        provider,
        owner,
        repo,
        ...(typeof s["baseBranch"] === "string" && s["baseBranch"].trim().length > 0
          ? { baseBranch: s["baseBranch"].trim() }
          : {}),
        ...(typeof s["installationId"] === "string" &&
        s["installationId"].trim().length > 0
          ? { installationId: s["installationId"].trim() }
          : typeof s["installationId"] === "number" &&
              Number.isFinite(s["installationId"])
            ? { installationId: String(Math.trunc(s["installationId"])) }
            : {}),
        ...(typeof s["apiBase"] === "string" && s["apiBase"].trim().length > 0
          ? { apiBase: s["apiBase"].trim() }
          : {}),
      };
    }
    out[key.trim()] = scm !== undefined ? { sandboxRoot, scm } : { sandboxRoot };
  }
  return out;
}

function readRegistryFileOrEmpty(filePath: string): string {
  if (!existsSync(filePath)) {
    return "{}";
  }
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      return "{}";
    }
    throw err;
  }
}

function writeRegistryFileAtomic(filePath: string, registry: WorkspaceRegistry): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  const tmp = join(dirname(filePath), `.${Date.now()}-${process.pid}.registry.tmp`);
  writeFileSync(tmp, payload, "utf8");
  renameSync(tmp, filePath);
}

/**
 * Preserve GitHub App installationId when a re-bind posts owner/repo without
 * the id (common after Portal refresh). Same owner+repo only — never carry an
 * id across a repo change.
 */
export function mergeRegistryEntryPreservingScmInstall(
  previous: WorkspaceRegistryEntry | undefined,
  next: WorkspaceRegistryEntry,
): WorkspaceRegistryEntry {
  if (!next.scm) {
    return next;
  }
  const prevScm = previous?.scm;
  if (!prevScm?.installationId || next.scm.installationId) {
    return next;
  }
  if (
    prevScm.provider === next.scm.provider &&
    prevScm.owner === next.scm.owner &&
    prevScm.repo === next.scm.repo
  ) {
    return {
      ...next,
      scm: {
        ...next.scm,
        installationId: prevScm.installationId,
      },
    };
  }
  return next;
}

/** Load registry from env (file preferred, then inline). Idempotent. */
export function loadWorkspaceRegistryFromEnv(): WorkspaceRegistry {
  if (loadedRegistry !== null) return loadedRegistry;

  const inline = (process.env["GOVERNED_WORKSPACE_REGISTRY"] ?? "").trim();
  const filePath = (process.env["GOVERNED_WORKSPACE_REGISTRY_FILE"] ?? "").trim();

  // Durable source of truth: FILE wins when set (Render /data survives redeploy).
  // Inline env is legacy / break-glass only and must not shadow a populated disk file.
  let raw = "";
  if (filePath.length > 0) {
    raw = readRegistryFileOrEmpty(filePath);
  } else if (inline.length > 0) {
    raw = inline.startsWith("{") ? inline : "";
    if (raw.length === 0) {
      try {
        raw = readFileSync(inline, "utf8");
      } catch {
        raw = inline;
      }
    }
  }

  if (raw.trim().length === 0) {
    loadedRegistry = {};
    return loadedRegistry;
  }

  loadedRegistry = parseRegistryJson(raw);
  return loadedRegistry;
}

/**
 * Reload registry from env/file, clearing the in-memory cache.
 * Used after S1b auto-provision writes GOVERNED_WORKSPACE_REGISTRY_FILE.
 */
export function reloadWorkspaceRegistryFromEnv(): WorkspaceRegistry {
  loadedRegistry = null;
  return loadWorkspaceRegistryFromEnv();
}

/**
 * Merge entries into the in-memory registry (and optionally persist to
 * GOVERNED_WORKSPACE_REGISTRY_FILE). INV-WS-1: callers must only supply
 * entries built via buildOrgSandboxRegistryEntry / server-side helpers.
 *
 * SCM merges preserve installationId when the incoming entry omits it but
 * owner/repo match the previous entry.
 */
export function mergeWorkspaceRegistryEntries(
  entries: Readonly<Record<string, WorkspaceRegistryEntry>>,
  options: { readonly persistFile?: boolean } = {},
): WorkspaceRegistry {
  const current = { ...loadWorkspaceRegistryFromEnv() };
  for (const [key, entry] of Object.entries(entries)) {
    const k = key.trim();
    if (k.length === 0) continue;
    current[k] = mergeRegistryEntryPreservingScmInstall(current[k], entry);
  }
  loadedRegistry = current;

  if (options.persistFile) {
    const filePath = (process.env["GOVERNED_WORKSPACE_REGISTRY_FILE"] ?? "").trim();
    if (filePath.length === 0) {
      throw new Error(
        "persistFile requires GOVERNED_WORKSPACE_REGISTRY_FILE to be set",
      );
    }
    writeRegistryFileAtomic(filePath, current);
  }

  return current;
}

/** Opaque durability snapshot for health / cert (never returns paths). */
export function workspaceRegistryDurabilitySnapshot(): {
  readonly configuredFile: boolean;
  readonly fileExists: boolean;
  readonly keyCount: number;
  readonly scmKeyCount: number;
  readonly installationBoundCount: number;
} {
  const filePath = (process.env["GOVERNED_WORKSPACE_REGISTRY_FILE"] ?? "").trim();
  const registry = loadWorkspaceRegistryFromEnv();
  const keys = Object.keys(registry);
  let scmKeyCount = 0;
  let installationBoundCount = 0;
  for (const entry of Object.values(registry)) {
    if (entry.scm) {
      scmKeyCount += 1;
      if (
        typeof entry.scm.installationId === "string" &&
        entry.scm.installationId.trim().length > 0
      ) {
        installationBoundCount += 1;
      }
    }
  }
  return {
    configuredFile: filePath.length > 0,
    fileExists: filePath.length > 0 && existsSync(filePath),
    keyCount: keys.length,
    scmKeyCount,
    installationBoundCount,
  };
}

/** Test hook — reset cached registry. */
export function resetWorkspaceRegistryForTests(): void {
  loadedRegistry = null;
}

export function setWorkspaceRegistryForTests(registry: WorkspaceRegistry): void {
  loadedRegistry = registry;
}

/**
 * Resolve a workspace_key to its server-bound entry, or null when unknown.
 * Empty key returns null (caller uses global env fallback).
 */
export function resolveWorkspaceEntry(workspaceKey: string | null | undefined): WorkspaceRegistryEntry | null {
  const key = typeof workspaceKey === "string" ? workspaceKey.trim() : "";
  if (key.length === 0) return null;
  const registry = loadWorkspaceRegistryFromEnv();
  return registry[key] ?? null;
}

export function isWorkspaceRegistryConfigured(): boolean {
  loadWorkspaceRegistryFromEnv();
  return loadedRegistry !== null && Object.keys(loadedRegistry).length > 0;
}
