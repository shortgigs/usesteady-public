/**
 * src/workflow/team-policy-pack.ts
 *
 * Team policy pack v1 — read-only workspace metadata.
 *
 * Loads `<workspace>/.usesteady/policy.json` for display in inspect and
 * run banners. Zero authority: no enforcement, routing, or approval
 * changes.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TeamPolicyPackV1 = {
  readonly policy_id: string;
  readonly owner:     string;
  readonly version:   string;
};

export type TeamPolicyLoadResult =
  | { readonly kind: "absent" }
  | { readonly kind: "ok"; readonly policy: TeamPolicyPackV1 }
  | { readonly kind: "invalid"; readonly reason: string };

export function teamPolicyPathFor(workspaceRoot: string): string {
  return join(workspaceRoot, ".usesteady", "policy.json");
}

function nonEmptyString(value: unknown, field: string): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

/**
 * Read-only load of the workspace team policy pack. Never throws.
 * Malformed files return `invalid`; missing file returns `absent`.
 */
export function loadTeamPolicyPack(workspaceRoot: string): TeamPolicyLoadResult {
  const path = teamPolicyPathFor(workspaceRoot);
  if (!existsSync(path)) {
    return { kind: "absent" };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return {
      kind: "invalid",
      reason: `could not read policy file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      kind: "invalid",
      reason: `policy JSON is malformed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "policy file must be a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;
  const policy_id = nonEmptyString(obj["policy_id"], "policy_id");
  const owner     = nonEmptyString(obj["owner"], "owner");
  const version   = nonEmptyString(obj["version"], "version");

  if (policy_id === null || owner === null || version === null) {
    return {
      kind: "invalid",
      reason: "policy file requires non-empty string fields: policy_id, owner, version.",
    };
  }

  return {
    kind: "ok",
    policy: Object.freeze({ policy_id, owner, version }),
  };
}

/** Text lines for workflow inspect (includes unreadable policy notice). */
export function renderTeamPolicyInspectLines(result: TeamPolicyLoadResult): readonly string[] {
  if (result.kind === "ok") {
    return renderTeamPolicyMetadataLines(result.policy);
  }
  if (result.kind === "invalid") {
    return [
      "  Team policy: unreadable (ignored for execution)",
      `    reason: ${result.reason}`,
    ];
  }
  return [];
}

/** Text lines for run banner — metadata only when policy file is valid. */
export function renderTeamPolicyRunBannerLines(result: TeamPolicyLoadResult): readonly string[] {
  if (result.kind !== "ok") {
    return [];
  }
  return renderTeamPolicyMetadataLines(result.policy);
}

function renderTeamPolicyMetadataLines(policy: TeamPolicyPackV1): readonly string[] {
  return [
    "  Team policy (read-only metadata)",
    `    policy_id: ${policy.policy_id}`,
    `    owner:     ${policy.owner}`,
    `    version:   ${policy.version}`,
  ];
}

/** @deprecated Use renderTeamPolicyInspectLines or renderTeamPolicyRunBannerLines. */
export function renderTeamPolicyTextLines(result: TeamPolicyLoadResult): readonly string[] {
  return renderTeamPolicyInspectLines(result);
}

export function teamPolicyMetadata(result: TeamPolicyLoadResult): TeamPolicyPackV1 | null {
  return result.kind === "ok" ? result.policy : null;
}
