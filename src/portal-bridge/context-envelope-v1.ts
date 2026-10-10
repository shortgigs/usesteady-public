/**
 * Sprint 8 — ContextEnvelope v1 (portal Understand bridge).
 * Promoted from certified TUI context-first probe.
 */

import { resolveWorkspaceRootCandidate } from "../workspace-context/probe.js";
import type { WorkspaceContextProbe } from "../workspace-context/types.js";

export const CONTEXT_ENVELOPE_FORMAT_V1 = "usesteady.context-envelope.v1" as const;

export type ContextEnvelopeV1 = {
  readonly format: typeof CONTEXT_ENVELOPE_FORMAT_V1;
  readonly workspace_root: string;
  readonly filesystem_readable: boolean;
  readonly repo_detected: boolean;
  readonly repo_label: string | null;
  readonly capabilities: {
    readonly read_files: boolean;
    readonly analyze: boolean;
    readonly plan: boolean;
    readonly execute: false;
  };
};

export type ContextEnvelopeParseFailure = {
  readonly ok: false;
  readonly code:
    | "context_required"
    | "invalid_context"
    | "missing_workspace_root"
    | "workspace_not_found"
    | "workspace_not_directory"
    | "workspace_not_readable";
  readonly message: string;
};

export type ContextEnvelopeParseResult =
  | { readonly ok: true; readonly envelope: ContextEnvelopeV1 }
  | ContextEnvelopeParseFailure;

export function contextEnvelopeFromProbe(
  probe: WorkspaceContextProbe,
): ContextEnvelopeV1 {
  return {
    format: CONTEXT_ENVELOPE_FORMAT_V1,
    workspace_root: probe.workspaceRoot,
    filesystem_readable: probe.filesystemReadable,
    repo_detected: probe.repoDetected,
    repo_label: probe.repoLabel,
    capabilities: {
      read_files: probe.capabilities.readFiles,
      analyze: probe.capabilities.analyze,
      plan: probe.capabilities.plan,
      execute: false,
    },
  };
}

function reasonToFailure(
  reason: "missing_root" | "not_found" | "not_directory" | "not_readable",
): ContextEnvelopeParseFailure {
  switch (reason) {
    case "missing_root":
      return {
        ok: false,
        code: "missing_workspace_root",
        message: "workspace_root is required in context.",
      };
    case "not_found":
      return {
        ok: false,
        code: "workspace_not_found",
        message: "workspace_root does not exist.",
      };
    case "not_directory":
      return {
        ok: false,
        code: "workspace_not_directory",
        message: "workspace_root must be a directory.",
      };
    case "not_readable":
      return {
        ok: false,
        code: "workspace_not_readable",
        message: "workspace_root is not readable.",
      };
  }
}

/**
 * Parse portal request `context` and probe filesystem bindings.
 * Accepts `{ workspace_root: string }` only in v1.
 */
export function parseContextEnvelopeInput(
  input: unknown,
): ContextEnvelopeParseResult {
  if (input === undefined || input === null) {
    return {
      ok: false,
      code: "context_required",
      message: "context envelope is required (workspace_root).",
    };
  }

  if (typeof input !== "object") {
    return {
      ok: false,
      code: "invalid_context",
      message: "context must be an object with workspace_root.",
    };
  }

  const workspaceRoot = (input as { workspace_root?: unknown }).workspace_root;
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    return {
      ok: false,
      code: "missing_workspace_root",
      message: "context.workspace_root is required.",
    };
  }

  const probe = resolveWorkspaceRootCandidate(workspaceRoot);
  if (!probe.ok) {
    return reasonToFailure(probe.reason);
  }

  return { ok: true, envelope: contextEnvelopeFromProbe(probe.context) };
}
