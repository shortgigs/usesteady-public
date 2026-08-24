/**
 * src/friction/types.ts
 *
 * Shared types for the friction capture pipeline.
 *
 * Design rules:
 *  - All types are plain data (no methods, no class instances).
 *  - Nothing here imports from the workflow domain — friction capture
 *    is a side-channel; it must never block or slow the core path.
 *  - The admin / payout / collection backend types live in the private
 *    the private ops repo and are NOT exported from here.
 */
export type FrictionKind = "workflow-failure" | "server-error" | "ux-block" | "install-error" | "manual-cli";
export interface FrictionEvent {
    readonly kind: FrictionKind;
    readonly capturedAt: string;
    readonly usesteadyVersion: string;
    readonly context: FrictionContext;
    readonly notes?: string;
}
export interface FrictionContext {
    readonly runId?: string;
    readonly phase?: string;
    readonly taskInputs?: readonly string[];
    readonly failureNote?: string;
    readonly workspaceRoot?: string;
    readonly errorMessage?: string;
    readonly errorStack?: string;
    readonly route?: string;
    readonly platform?: string;
    readonly nodeVersion?: string;
}
export type QueueStatus = "pending" | "submitted" | "failed";
export interface QueueEntry {
    readonly id: string;
    readonly event: FrictionEvent;
    readonly status: QueueStatus;
    readonly attempts: number;
    readonly createdAt: string;
    readonly submittedAt?: string;
    readonly lastError?: string;
}
export interface FrictionReport {
    readonly id: string;
    readonly kind: FrictionKind;
    readonly reporterGitHub?: string;
    readonly event: FrictionEvent;
    readonly submittedAt: string;
}
export interface AuthToken {
    readonly githubToken: string;
    readonly githubLogin: string;
    readonly githubEmail?: string;
    readonly obtainedAt: string;
}
export interface FrictionConfig {
    /** GitHub API endpoint for issue creation. Default: Shortgigs collection repo. */
    readonly frictionEndpoint: string;
    /** GitHub repo slug for label + issue management. */
    readonly frictionRepo: string;
}
export declare const DEFAULT_FRICTION_CONFIG: FrictionConfig;
//# sourceMappingURL=types.d.ts.map