// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
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

// ─── Friction kinds ───────────────────────────────────────────────────────────

export type FrictionKind =
  | "workflow-failure"   // task_failed, stopped, or skipped_by_intake
  | "server-error"       // unhandled Express error
  | "ux-block"           // user-initiated report from the UI
  | "install-error"      // CLI crash captured at startup
  | "manual-cli";        // `usesteady report` freeform CLI report

// ─── Raw friction event (captured at the source) ─────────────────────────────

export interface FrictionEvent {
  readonly kind:             FrictionKind;
  readonly capturedAt:       string;           // ISO 8601
  readonly usesteadyVersion: string;
  readonly context:          FrictionContext;
  readonly notes?:           string;           // user-added freetext
}

export interface FrictionContext {
  // Workflow-failure context (present when kind === "workflow-failure")
  readonly runId?:       string;
  readonly phase?:       string;
  readonly taskInputs?:  readonly string[];
  readonly failureNote?: string;
  readonly workspaceRoot?: string;

  // Server-error context (present when kind === "server-error")
  readonly errorMessage?: string;
  readonly errorStack?:   string;
  readonly route?:        string;

  // Platform context (always present)
  readonly platform?: string;    // process.platform
  readonly nodeVersion?: string; // process.version
}

// ─── Queue entry (persisted in SQLite before submission) ─────────────────────

export type QueueStatus = "pending" | "submitted" | "failed";

export interface QueueEntry {
  readonly id:          string;          // ULID / random uuid
  readonly event:       FrictionEvent;
  readonly status:      QueueStatus;
  readonly attempts:    number;
  readonly createdAt:   string;          // ISO 8601
  readonly submittedAt?: string;         // ISO 8601, set on success
  readonly lastError?:  string;          // last submission error message
}

// ─── Submitted report (what lands in the collection backend) ─────────────────

export interface FrictionReport {
  readonly id:             string;       // matches QueueEntry.id
  readonly kind:           FrictionKind;
  readonly reporterGitHub?: string;      // GitHub login, if authenticated
  readonly event:          FrictionEvent;
  readonly submittedAt:    string;       // ISO 8601
}

// ─── Auth token (stored in ~/.usesteady/auth.json) ────────────────────────────

export interface AuthToken {
  readonly githubToken:    string;
  readonly githubLogin:    string;
  readonly githubEmail?:   string;
  readonly obtainedAt:     string;       // ISO 8601
}

// ─── Config (stored in ~/.usesteady/config.json) ─────────────────────────────

export interface FrictionConfig {
  /** GitHub API endpoint for issue creation. Default: Shortgigs collection repo. */
  readonly frictionEndpoint: string;
  /** GitHub repo slug for label + issue management. */
  readonly frictionRepo:     string;
}

export const DEFAULT_FRICTION_CONFIG: FrictionConfig = {
  frictionEndpoint: "https://api.github.com/repos/<your-org>/<your-friction-repo>/issues",
  frictionRepo:     "<your-org>/<your-friction-repo>",
};
