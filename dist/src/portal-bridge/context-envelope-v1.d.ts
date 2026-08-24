/**
 * Sprint 8 — ContextEnvelope v1 (portal Understand bridge).
 * Promoted from certified TUI context-first probe.
 */
import type { WorkspaceContextProbe } from "../workspace-context/types.js";
export declare const CONTEXT_ENVELOPE_FORMAT_V1: "usesteady.context-envelope.v1";
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
    readonly code: "context_required" | "invalid_context" | "missing_workspace_root" | "workspace_not_found" | "workspace_not_directory" | "workspace_not_readable";
    readonly message: string;
};
export type ContextEnvelopeParseResult = {
    readonly ok: true;
    readonly envelope: ContextEnvelopeV1;
} | ContextEnvelopeParseFailure;
export declare function contextEnvelopeFromProbe(probe: WorkspaceContextProbe): ContextEnvelopeV1;
/**
 * Parse portal request `context` and probe filesystem bindings.
 * Accepts `{ workspace_root: string }` only in v1.
 */
export declare function parseContextEnvelopeInput(input: unknown): ContextEnvelopeParseResult;
//# sourceMappingURL=context-envelope-v1.d.ts.map