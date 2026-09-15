/**
 * Deterministic replay sandbox identity — no timestamps (Sprint #36b).
 */

import { createHash } from "node:crypto";

export function replaySandboxId(input: {
  readonly execution_id: string;
  readonly reconstructed_capability_id: string;
  readonly replay_version: string;
}): string {
  const payload = [
    input.execution_id.trim(),
    input.reconstructed_capability_id.trim(),
    input.replay_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function replaySandboxEnvelopeId(input: {
  readonly replay_sandbox_id: string;
  readonly replay_version: string;
}): string {
  const payload = [
    input.replay_sandbox_id.trim(),
    input.replay_version.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function replaySandboxBundleId(input: {
  readonly source_job_id: string;
  readonly replay_sandbox_id: string;
  readonly replay_version: string;
}): string {
  const payload = [
    input.source_job_id.trim(),
    input.replay_sandbox_id.trim(),
    input.replay_version.trim(),
  ].join("\0");
  return `sandbox-bundle-${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}
