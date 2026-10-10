/**
 * Workflow Health Diagnostics — types (observe-only).
 * @see docs/product/workflow-health-diagnostics-contract-v1.md
 * @see docs/product/workflow-health-diagnostics-implementation-contract-v1.md
 */

import type { EffectiveState } from "../shell/cli/entitlement-cache.js";

export type DiagnosticClass =
  | "identity"
  | "billing"
  | "entitlement"
  | "portal"
  | "runtime";

export type ObservationSeverity = "warn" | "error";

export type DiagnosticOverall = "healthy" | "warn" | "error";

export type DiagnosticObservation = {
  readonly class: DiagnosticClass;
  readonly code: string;
  readonly severity: ObservationSeverity;
  readonly message: string;
  readonly observed_at: string;
  readonly evidence?: Readonly<Record<string, string | number | boolean | null>>;
};

export type DiagnosticLineageEntry = {
  readonly at: string;
  readonly kind: "run" | "recheck";
  readonly outcome: "completed";
};

export type DiagnosticRecord = {
  readonly diagnostic_id: string;
  readonly run_at: string;
  readonly overall: DiagnosticOverall;
  readonly effective_state?: EffectiveState;
  readonly observations: readonly DiagnosticObservation[];
  readonly suggested_actions: readonly string[];
  readonly lineage: readonly DiagnosticLineageEntry[];
};
