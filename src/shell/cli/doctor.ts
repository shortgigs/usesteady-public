/**
 * usesteady doctor -- environment / install readiness checks.
 * No governed effect. D5 writes a probe and attempts cleanup.
 *
 * Pure probe + render module. Design lock:
 * docs/product/usesteady-doctor-design-v1.md
 *
 * Authority:
 *   - Does not execute, approve, load specs, or mutate config.
 *   - The only filesystem write is the ephemeral D5 store-writable probe
 *     (`.doctor-probe-${pid}`), removal attempted in `finally` (best effort).
 *   - No telemetry.
 *   - D11 only: optional localhost HTTP probe to Ollama `/api/tags`
 *     (P0-1 truth gap — no generation, routing, or model selection).
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DiagnosticRecord } from "../../diagnostics/types.js";
import { renderWorkflowHealthSection } from "../../diagnostics/render.js";
import { generateRemediationProposalsFromDiagnostic } from "../../remediation/proposal-generator.js";
import { renderRemediationProposalsSection } from "../../remediation/render.js";
import {
  describeAuditStoreDurability,
  resolveStoreDir,
} from "../defaults.js";
import { NO_GOVERNED_EFFECT_LABEL, TEMPORARY_STORE_MUTATION_LABEL } from "../operator-surface.js";
import type { OllamaProbeOutcome } from "./ollama-probe.js";
import {
  probeProviderVisibility,
  renderProviderVisibilityLines,
  type ProviderVisibilitySnapshot,
} from "./provider-visibility.js";

export const MIN_NODE_MAJOR = 20;

export const DOCTOR_DISCLAIMER_LINES = [
  "Doctor checks environment readiness only. It does not validate workflow specs,",
  "approve changes, or grant permission to execute. Passing checks does not mean",
  "a workflow is safe to run without your explicit approval.",
] as const;

export type DoctorSeverity = "ok" | "warn" | "fail" | "info";

export type DoctorCheckResult = {
  readonly id: string;
  readonly severity: DoctorSeverity;
  readonly label: string;
  readonly detail: string;
};

export type DoctorProbeContext = {
  readonly nodeVersion: string;
  readonly packageVersion: string | null;
  readonly storeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly pid: number;
};

export type DoctorCheckOptions = Partial<DoctorProbeContext> & {
  /** Injected by CLI after `probeOllamaReachable`; defaults to not_configured in pure tests. */
  readonly ollamaProbe?: OllamaProbeOutcome;
  /** Injected for render; defaults via env in CLI when omitted. */
  readonly providerVisibility?: ProviderVisibilitySnapshot;
  /** Workflow Health diagnostics record (observe-only). */
  readonly workflowHealth?: DiagnosticRecord;
};

const CHECK_IDS = [
  "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11",
  "D12", "D13", "D14", "D15", "D16", "D17",
] as const;

/** Advanced override for tests / operators; not advertised in v1 help text. */
export function resolveDoctorStoreDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveStoreDir(env);
}

/** Same manifest walk as `usesteady --version`. */
export function resolveUseSteadyPackageVersion(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    try {
      const raw = readFileSync(resolve(dir, "package.json"), "utf-8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === "usesteady" && typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseNodeMajor(nodeVersion: string): number | null {
  const match = /^v(\d+)/.exec(nodeVersion);
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

/** D5 probe only. Returns true when writable. Never throws. */
export function probeStoreWritable(storeDir: string, pid: number): boolean {
  const probePath = join(storeDir, `.doctor-probe-${String(pid)}`);
  try {
    writeFileSync(probePath, "", { flag: "w" });
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (existsSync(probePath)) unlinkSync(probePath);
    } catch {
      /* best-effort cleanup */
    }
  }
}

function countLiveRunArtifacts(storeDir: string): number | null {
  const liveRunsDir = join(storeDir, "live-runs");
  if (!existsSync(liveRunsDir)) return 0;
  try {
    return readdirSync(liveRunsDir).filter((name) => name.endsWith(".json")).length;
  } catch {
    return null;
  }
}

function defaultProbeContext(options: DoctorCheckOptions = {}): DoctorProbeContext {
  return {
    nodeVersion:     options.nodeVersion     ?? process.version,
    packageVersion:  options.packageVersion  ?? resolveUseSteadyPackageVersion(),
    storeDir:        options.storeDir        ?? resolveDoctorStoreDir(options.env),
    env:             options.env             ?? process.env,
    pid:             options.pid             ?? process.pid,
  };
}

export function runDoctorChecks(options: DoctorCheckOptions = {}): readonly DoctorCheckResult[] {
  const ctx = defaultProbeContext(options);
  const checks: DoctorCheckResult[] = [];

  const nodeMajor = parseNodeMajor(ctx.nodeVersion);
  if (nodeMajor === null || nodeMajor < MIN_NODE_MAJOR) {
    checks.push({
      id:       "D1",
      severity: "fail",
      label:    `Node.js >= ${MIN_NODE_MAJOR}`,
      detail:   ctx.nodeVersion,
    });
  } else {
    checks.push({
      id:       "D1",
      severity: "ok",
      label:    `Node.js >= ${MIN_NODE_MAJOR}`,
      detail:   ctx.nodeVersion,
    });
  }

  if (ctx.packageVersion === null) {
    checks.push({
      id:       "D2",
      severity: "fail",
      label:    "usesteady package version",
      detail:   "could not resolve package.json",
    });
  } else {
    checks.push({
      id:       "D2",
      severity: "ok",
      label:    "usesteady",
      detail:   ctx.packageVersion,
    });
  }

  const storeExists = existsSync(ctx.storeDir);
  if (!storeExists) {
    checks.push({
      id:       "D3",
      severity: "fail",
      label:    "store directory exists",
      detail:   ctx.storeDir,
    });
  } else {
    checks.push({
      id:       "D3",
      severity: "ok",
      label:    "store directory exists",
      detail:   ctx.storeDir,
    });
  }

  let storeReadable = false;
  if (!storeExists) {
    checks.push({
      id:       "D4",
      severity: "info",
      label:    "store readable",
      detail:   "skipped (store does not exist)",
    });
  } else {
    try {
      readdirSync(ctx.storeDir);
      storeReadable = true;
      checks.push({
        id:       "D4",
        severity: "ok",
        label:    "store readable",
        detail:   ctx.storeDir,
      });
    } catch {
      checks.push({
        id:       "D4",
        severity: "fail",
        label:    "store readable",
        detail:   ctx.storeDir,
      });
    }
  }

  if (!storeExists || !storeReadable) {
    checks.push({
      id:       "D5",
      severity: "info",
      label:    "store writable",
      detail:   "skipped (store not available)",
    });
  } else if (probeStoreWritable(ctx.storeDir, ctx.pid)) {
    checks.push({
      id:       "D5",
      severity: "ok",
      label:    "store writable",
      detail:   "",
    });
  } else {
    checks.push({
      id:       "D5",
      severity: "warn",
      label:    "store writable",
      detail:   ctx.storeDir,
    });
  }

  const anthropicKeySet = Boolean(ctx.env["ANTHROPIC_API_KEY"]?.trim());
  checks.push({
    id:       "D6",
    severity: anthropicKeySet ? "ok" : "info",
    label:    anthropicKeySet ? "ANTHROPIC_API_KEY set" : "ANTHROPIC_API_KEY not set",
    detail:   anthropicKeySet ? "" : "Claude live mode unavailable",
  });

  const useClaudeRaw = ctx.env["USESTEADY_USE_CLAUDE"];
  const useClaudeLabel = useClaudeRaw === undefined
    ? "USESTEADY_USE_CLAUDE unset (stub mode)"
    : `USESTEADY_USE_CLAUDE=${useClaudeRaw}`;
  checks.push({
    id:       "D7",
    severity: "info",
    label:    useClaudeLabel,
    detail:   "",
  });

  const claudeLive = useClaudeRaw === "true";
  if (!claudeLive) {
    checks.push({
      id:       "D8",
      severity: "info",
      label:    "Claude readiness",
      detail:   "stub mode (USESTEADY_USE_CLAUDE not true)",
    });
  } else if (!anthropicKeySet) {
    checks.push({
      id:       "D8",
      severity: "warn",
      label:    "Claude readiness",
      detail:   "USESTEADY_USE_CLAUDE=true but ANTHROPIC_API_KEY is not set",
    });
  } else {
    checks.push({
      id:       "D8",
      severity: "ok",
      label:    "Claude readiness",
      detail:   "live mode configured",
    });
  }

  const liveRunCount = storeExists ? countLiveRunArtifacts(ctx.storeDir) : 0;
  if (liveRunCount === null) {
    checks.push({
      id:       "D9",
      severity: "info",
      label:    "in-progress UI runs in store",
      detail:   "live-runs directory not readable",
    });
  } else if (liveRunCount === 0) {
    checks.push({
      id:       "D9",
      severity: "info",
      label:    "no in-progress UI runs in store",
      detail:   "",
    });
  } else {
    checks.push({
      id:       "D9",
      severity: "warn",
      label:    "in-progress UI runs in store",
      detail:   `${liveRunCount} live-runs artifact(s) present (may be stale)`,
    });
  }

  checks.push({
    id:       "D10",
    severity: "info",
    label:    "spec checks",
    detail:   "usesteady workflow inspect <spec.json>",
  });

  const ollamaProbe = options.ollamaProbe ?? { kind: "not_configured" as const };
  if (ollamaProbe.kind === "reachable") {
    checks.push({
      id:       "D11",
      severity: "ok",
      label:    "Ollama local analyze",
      detail:   `reachable at ${ollamaProbe.endpoint}`,
    });
  } else if (ollamaProbe.kind === "unreachable") {
    checks.push({
      id:       "D11",
      severity: "warn",
      label:    "Ollama local analyze",
      detail:   `configured but unreachable at ${ollamaProbe.endpoint}`,
    });
  } else {
    checks.push({
      id:       "D11",
      severity: "info",
      label:    "Ollama local analyze not configured",
      detail:   "install Ollama locally or set OLLAMA_HOST",
    });
  }

  // Grok / xAI readiness — one of the optional, peer LLM providers. Mirrors the
  // Claude block (D6/D7/D8) so both opt-in paths report at parity.
  const xaiKeySet = Boolean(ctx.env["XAI_API_KEY"]?.trim());
  checks.push({
    id:       "D12",
    severity: xaiKeySet ? "ok" : "info",
    label:    xaiKeySet ? "XAI_API_KEY set" : "XAI_API_KEY not set",
    detail:   xaiKeySet ? "" : "Grok live mode unavailable",
  });

  const useGrokRaw = ctx.env["USESTEADY_USE_GROK"];
  const useGrokLabel = useGrokRaw === undefined
    ? "USESTEADY_USE_GROK unset (deterministic by default)"
    : `USESTEADY_USE_GROK=${useGrokRaw}`;
  checks.push({
    id:       "D13",
    severity: "info",
    label:    useGrokLabel,
    detail:   "",
  });

  const grokLive = useGrokRaw === "true";
  if (!grokLive) {
    checks.push({
      id:       "D14",
      severity: "info",
      label:    "Grok readiness",
      detail:   "deterministic mode (USESTEADY_USE_GROK not true)",
    });
  } else if (!xaiKeySet) {
    checks.push({
      id:       "D14",
      severity: "warn",
      label:    "Grok readiness",
      detail:   "USESTEADY_USE_GROK=true but XAI_API_KEY is not set",
    });
  } else {
    checks.push({
      id:       "D14",
      severity: "ok",
      label:    "Grok readiness",
      detail:   "live mode configured",
    });
  }

  // Execution Return Bridge (P0-49) readiness — opt-in run reporting to Portal.
  // Read-only env probe (no network), mirroring the Claude/Grok opt-in blocks.
  // Reporting is default-off; this only reports whether the opt-in transport
  // is *configured* — never whether a run is safe to execute.
  const portalRunsUrlSet = Boolean(ctx.env["USESTEADY_PORTAL_RUNS_URL"]?.trim());
  const portalTokenSet = Boolean(ctx.env["USESTEADY_PORTAL_TOKEN"]?.trim());
  if (portalRunsUrlSet && portalTokenSet) {
    checks.push({
      id:       "D15",
      severity: "ok",
      label:    "Execution Return Bridge",
      detail:   "configured (opt-in per run via --report-to-portal)",
    });
  } else if (portalRunsUrlSet || portalTokenSet) {
    checks.push({
      id:       "D15",
      severity: "warn",
      label:    "Execution Return Bridge",
      detail:   portalRunsUrlSet
        ? "USESTEADY_PORTAL_RUNS_URL set but USESTEADY_PORTAL_TOKEN missing"
        : "USESTEADY_PORTAL_TOKEN set but USESTEADY_PORTAL_RUNS_URL missing",
    });
  } else {
    checks.push({
      id:       "D15",
      severity: "info",
      label:    "Execution Return Bridge not configured",
      detail:   "set USESTEADY_PORTAL_RUNS_URL + USESTEADY_PORTAL_TOKEN to enable --report-to-portal",
    });
  }

  // Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) readiness — opt-in
  // live remote approval. Read-only env probe (no network), mirroring D15. The
  // bridge is default-off; this reports only whether the opt-in transport is
  // *configured* (URL + shared token), never whether a gate is safe to approve.
  // The URL is independent of the return bridge's; the bearer token is shared.
  const portalApprovalsUrlSet = Boolean(ctx.env["USESTEADY_PORTAL_APPROVALS_URL"]?.trim());
  const portalApprovalsTokenSet = Boolean(ctx.env["USESTEADY_PORTAL_TOKEN"]?.trim());
  if (portalApprovalsUrlSet && portalApprovalsTokenSet) {
    checks.push({
      id:       "D16",
      severity: "ok",
      label:    "Pending Approval Bridge",
      detail:   "configured (opt-in per run via --pending-approval-bridge)",
    });
  } else if (portalApprovalsUrlSet || portalApprovalsTokenSet) {
    checks.push({
      id:       "D16",
      severity: "warn",
      label:    "Pending Approval Bridge",
      detail:   portalApprovalsUrlSet
        ? "USESTEADY_PORTAL_APPROVALS_URL set but USESTEADY_PORTAL_TOKEN missing"
        : "USESTEADY_PORTAL_TOKEN set but USESTEADY_PORTAL_APPROVALS_URL missing",
    });
  } else {
    checks.push({
      id:       "D16",
      severity: "info",
      label:    "Pending Approval Bridge not configured",
      detail:   "set USESTEADY_PORTAL_APPROVALS_URL + USESTEADY_PORTAL_TOKEN to enable --pending-approval-bridge",
    });
  }

  // P-DISC — ephemeral vs configured-local. Discoverability only.
  // Does not claim tamper evidence, retention, or architectural durability.
  const durability = describeAuditStoreDurability(ctx.env, ctx.storeDir);
  if (durability.class === "ephemeral") {
    const source =
      durability.source === "default"
        ? "default OS temp store"
        : "USESTEADY_STORE_DIR still resolves under OS temp";
    checks.push({
      id:       "D17",
      severity: "warn",
      label:    "audit store is ephemeral",
      detail:   `${source}: ${durability.path}. ${durability.configureHint}`,
    });
  } else {
    checks.push({
      id:       "D17",
      severity: "ok",
      label:    "audit store configured outside OS temp",
      detail:
        `${durability.path} via ${durability.source}. Discoverability only — not tamper evidence.`,
    });
  }

  for (let i = 0; i < checks.length; i += 1) {
    const expected = CHECK_IDS[i];
    const actual = checks[i]?.id;
    if (actual !== expected) {
      throw new Error(`doctor check order drift: expected ${expected}, got ${actual ?? "missing"}`);
    }
  }

  return Object.freeze(checks);
}

function severityTag(severity: DoctorSeverity): string {
  return `[${severity}]`;
}

function formatCheckLine(check: DoctorCheckResult): string {
  const tag = severityTag(check.severity).padEnd(6, " ");
  let body = check.label;
  if (check.detail.length > 0) {
    body = check.id === "D10"
      ? `${check.label}: ${check.detail}`
      : `${check.label} (${check.detail})`;
  }
  return `  ${tag}  ${body}`;
}

export function summarizeDoctorChecks(
  checks: readonly DoctorCheckResult[],
): { ok: number; warn: number; fail: number } {
  let ok = 0;
  let warn = 0;
  let fail = 0;
  for (const check of checks) {
    if (check.severity === "ok") ok += 1;
    else if (check.severity === "warn") warn += 1;
    else if (check.severity === "fail") fail += 1;
  }
  return { ok, warn, fail };
}

export function renderDoctorText(
  checks: readonly DoctorCheckResult[],
  options: DoctorCheckOptions = {},
): string {
  const summary = summarizeDoctorChecks(checks);
  const ctx = defaultProbeContext(options);
  const providerVisibility = options.providerVisibility ?? probeProviderVisibility(ctx.env);
  const lines: string[] = [
    "",
    "  UseSteady doctor",
    `  ${TEMPORARY_STORE_MUTATION_LABEL}; ${NO_GOVERNED_EFFECT_LABEL} (D5 writability probe).`,
    "",
  ];

  for (const check of checks) {
    lines.push(formatCheckLine(check));
  }

  lines.push(...renderProviderVisibilityLines(providerVisibility));

  if (options.workflowHealth) {
    lines.push(renderWorkflowHealthSection(options.workflowHealth));
    const proposalRecord = generateRemediationProposalsFromDiagnostic(
      options.workflowHealth,
    );
    lines.push(renderRemediationProposalsSection(proposalRecord));
  }

  lines.push("");
  lines.push(`  Summary: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail`);
  lines.push("");
  for (const line of DOCTOR_DISCLAIMER_LINES) {
    lines.push(`  ${line}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderDoctorHelpText(): string {
  return (
    "\n  Usage: usesteady doctor\n" +
    `\n  Check local install and environment readiness (${TEMPORARY_STORE_MUTATION_LABEL}; ${NO_GOVERNED_EFFECT_LABEL}).\n` +
    "  Does not validate workflow specs, execute operations, or require --yes.\n" +
    "  D5 creates or truncates a probe and attempts removal; cleanup is best effort.\n" +
    "  Reports whether the audit store is ephemeral (OS temp default) or\n" +
    "  configured local via USESTEADY_STORE_DIR. That is discoverability\n" +
    "  only — not tamper evidence or a retention guarantee.\n" +
    "\n  For spec-level checks, run: usesteady workflow inspect <spec.json>\n\n"
  );
}
