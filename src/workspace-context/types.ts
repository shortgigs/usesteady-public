/**
 * Workspace context probe types — shared by TUI context-first and portal ContextEnvelope.
 */

export type WorkspaceContextProbe = {
  readonly workspaceRoot: string;
  readonly filesystemReadable: boolean;
  readonly repoDetected: boolean;
  /** Folder name when repo detected; otherwise null. */
  readonly repoLabel: string | null;
  readonly capabilities: {
    readonly readFiles: boolean;
    readonly analyze: boolean;
    readonly plan: boolean;
    /** Always false until execution is explicitly authorized on a surface. */
    readonly execute: false;
  };
};

export type WorkspaceContextProbeFailureReason =
  | "missing_root"
  | "not_found"
  | "not_directory"
  | "not_readable";

export type WorkspaceContextProbeResult =
  | { readonly ok: true; readonly context: WorkspaceContextProbe }
  | { readonly ok: false; readonly reason: WorkspaceContextProbeFailureReason };
