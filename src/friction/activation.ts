// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/activation.ts
 *
 * Lightweight activation / proof metric capture.
 *
 * Default behavior:
 *   1. Local JSONL — ~/.usesteady/activation.jsonl (local to the operator).
 *   2. Remote HTTP/PostHog — OFF unless explicitly enabled.
 *
 * Remote opt-in:
 *   - USESTEADY_TELEMETRY=1|true|on|enabled enables the path/content-free
 *     activation endpoint.
 *   - POSTHOG_KEY also enables remote telemetry for existing operator-managed
 *     PostHog configurations; PostHog itself still no-ops without a key.
 *
 * Full opt-out:
 *   - USESTEADY_TELEMETRY=0|false|off|disabled disables local and remote capture.
 *
 * Privacy / safety contract:
 *   - Never throws and never blocks the execution path.
 *   - No prompts, source code, file paths, command text, credentials, or customer
 *     content are accepted by the proof-event API.
 *   - Telemetry state carries zero execution authority and cannot change a proof
 *     decision or observation result.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capture } from "./posthog.js";

export type ActivationEventName =
  | "onboarding_started"
  | "example_approved"
  | "second_prompt_entered"
  | ProofActivationEventName;

export type ProofActivationEventName =
  | "proof_started"
  | "proof_stage_completed"
  | "proof_completed"
  | "proof_failed";

export type ProofStageName = "verified" | "refusal" | "unresolved";
export type ProofDecisionKind = "accepted" | "refused";
export type ProofObservationStatus =
  | "verified"
  | "disagreement"
  | "unknown"
  | "unverified"
  | "not_observed";

export type ProofActivationProperties = {
  readonly stage?: ProofStageName;
  readonly decision?: ProofDecisionKind;
  readonly refusalCode?: string;
  readonly observationStatus?: ProofObservationStatus;
  readonly elapsedMs?: number;
  /** Stable internal category only — never a raw Error.message or stack. */
  readonly errorCategory?: "proof_invariant" | "unexpected";
};

export type ActivationPayload = {
  readonly event: ActivationEventName;
  readonly session: string;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly version: string;
  readonly ts: string;
  readonly ms?: number;
  readonly stage?: ProofStageName;
  readonly decision?: ProofDecisionKind;
  readonly refusalCode?: string;
  readonly observationStatus?: ProofObservationStatus;
  readonly errorCategory?: "proof_invariant" | "unexpected";
};

const USESTEADY_DIR = join(homedir(), ".usesteady");
const ACTIVATION_LOG = join(USESTEADY_DIR, "activation.jsonl");
const ENDPOINT = "https://usesteady.dev/api/activation";

let _version: string | null = null;

function packageVersion(): string {
  if (_version) return _version;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../package.json"), // dist/src/friction -> package root
    join(here, "../../package.json"),    // src/friction -> package root
    join(process.cwd(), "package.json"),
  ];
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "usesteady" && typeof pkg.version === "string" && pkg.version.length > 0) {
        _version = pkg.version;
        return _version;
      }
    } catch {
      // Try the next deterministic candidate.
    }
  }
  _version = "unknown";
  return _version;
}

function normalizedTelemetryValue(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return env["USESTEADY_TELEMETRY"]?.trim().toLowerCase();
}

export function telemetryDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = normalizedTelemetryValue(env);
  return raw === "0" || raw === "false" || raw === "off" || raw === "disabled";
}

export function remoteTelemetryEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (telemetryDisabled(env)) return false;
  const raw = normalizedTelemetryValue(env);
  const explicit = raw === "1" || raw === "true" || raw === "on" || raw === "enabled";
  const posthogConfigured = Boolean(env["POSTHOG_KEY"]?.trim());
  return explicit || posthogConfigured;
}

export function newActivationSession(): string {
  return randomUUID();
}

function writePayload(payload: ActivationPayload): void {
  if (telemetryDisabled()) return;
  try {
    const line = JSON.stringify(payload);

    // Local, operator-visible measurement. No network required.
    try {
      if (!existsSync(USESTEADY_DIR)) mkdirSync(USESTEADY_DIR, { recursive: true });
      appendFileSync(ACTIVATION_LOG, `${line}\n`, "utf8");
    } catch {
      // Local metrics are best-effort only.
    }

    // Remote measurement is explicit opt-in. Never await or throw into execution.
    if (remoteTelemetryEnabled()) {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: line,
      }).catch(() => { /* offline / endpoint down — never block */ });

      const { event, session, platform, nodeVersion, version, ms, stage, decision,
        refusalCode, observationStatus, errorCategory } = payload;
      capture(event, {
        session,
        platform,
        nodeVersion,
        version,
        ...(ms !== undefined ? { ms } : {}),
        ...(stage !== undefined ? { stage } : {}),
        ...(decision !== undefined ? { decision } : {}),
        ...(refusalCode !== undefined ? { refusalCode } : {}),
        ...(observationStatus !== undefined ? { observationStatus } : {}),
        ...(errorCategory !== undefined ? { errorCategory } : {}),
      });
    }
  } catch {
    // Telemetry is evidence/measurement only; it must never affect execution.
  }
}

export function buildActivationPayload(
  event: ActivationEventName,
  sessionId: string,
  opts: {
    readonly ms?: number;
    readonly proof?: ProofActivationProperties;
    /** Test/release-harness seam. Production uses the installed package version. */
    readonly version?: string;
    readonly now?: Date;
    readonly platform?: string;
    readonly nodeVersion?: string;
  } = {},
): ActivationPayload {
  const proof = opts.proof;
  return {
    event,
    session: sessionId,
    platform: opts.platform ?? process.platform,
    nodeVersion: opts.nodeVersion ?? process.version,
    version: opts.version ?? packageVersion(),
    ts: (opts.now ?? new Date()).toISOString(),
    ...(opts.ms !== undefined ? { ms: opts.ms } : {}),
    ...(proof?.stage !== undefined ? { stage: proof.stage } : {}),
    ...(proof?.decision !== undefined ? { decision: proof.decision } : {}),
    ...(proof?.refusalCode !== undefined ? { refusalCode: proof.refusalCode } : {}),
    ...(proof?.observationStatus !== undefined ? { observationStatus: proof.observationStatus } : {}),
    ...(proof?.errorCategory !== undefined ? { errorCategory: proof.errorCategory } : {}),
  };
}

/** Existing onboarding metric API. */
export function captureActivation(
  event: "onboarding_started" | "example_approved" | "second_prompt_entered",
  sessionId: string,
  ms?: number,
): void {
  if (telemetryDisabled()) return;
  writePayload(buildActivationPayload(event, sessionId, { ...(ms !== undefined ? { ms } : {}) }));
}

/**
 * R0 proof metric API. Properties are an allowlisted non-content schema.
 * Callers cannot pass arbitrary property bags, paths, prompts, or source text.
 */
export function captureProofActivation(
  event: ProofActivationEventName,
  sessionId: string,
  properties: ProofActivationProperties = {},
): void {
  if (telemetryDisabled()) return;
  writePayload(buildActivationPayload(event, sessionId, {
    ...(properties.elapsedMs !== undefined ? { ms: properties.elapsedMs } : {}),
    proof: properties,
  }));
}
