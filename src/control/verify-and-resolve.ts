// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/control/verify-and-resolve.ts
 *
 * UseSteady Control Gate v0 — first enforced execution gate.
 *
 * Gate invariant
 * ──────────────
 *   "No human escalation before verification."
 *
 * Target friction
 * ───────────────
 *   An agent observes a stale deployment, a 404, or an unchanged deployment
 *   id and asks the human "what should I do?" before having attempted any
 *   deterministic verification.
 *
 *   This module returns a `ControlDecision` whose `can_escalate` flag is
 *   FALSE whenever a deterministic next action exists. The companion helper
 *   `assertCanEscalate` HARD-FAILS if a caller tries to escalate to a human
 *   despite a deterministic next action being available.
 *
 *   The flag is the contract. The throw is the enforcement.
 *
 * Scope (v0)
 * ──────────
 *   - Deployment-state verification only (`type: "deployment_check"`).
 *   - No generic framework. No DSL. No registry. No LLM. No agent.
 *   - No I/O, no spawn, no network. The function is a pure decision over
 *     the caller-supplied `expected` and `observed` snapshots.
 *
 * Determinism
 * ───────────
 *   `verifyAndResolve` is a pure total function. Same input → same output,
 *   byte-for-byte. No clock, no rng, no environment reads. The returned
 *   `expected` and `observed` records have sorted keys and undefined values
 *   filtered out so structural equality is stable.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type ControlStatus =
  | "ok"
  | "mismatch"
  | "blocked";

export type ControlClassification =
  | "healthy"
  | "stale_state"
  | "missing_action"
  | "failed_action"
  | "unknown";

export type ControlDecision = {
  status:              ControlStatus;
  classification:      ControlClassification;
  can_escalate:        boolean;
  expected:            Record<string, unknown>;
  observed:            Record<string, unknown>;
  actions_attempted:   string[];
  next_allowed_action: string | null;
  blocker:             string | null;
};

export type DeploymentCheckInput = {
  type: "deployment_check";
  expected: {
    pr?:            number;
    branch?:        string;
    commit?:        string;
    deployment_id?: string;
  };
  observed: {
    http_status?:     number;
    deployment_id?:   string;
    deployed_commit?: string;
    workflow_status?: "not_run" | "running" | "failed" | "success" | "unknown";
  };
};

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Decide whether a deployment-state observation matches expectations and,
 * if not, surface a deterministic next action. The decision is the contract;
 * `assertCanEscalate` is the enforcement.
 */
export function verifyAndResolve(input: DeploymentCheckInput): ControlDecision {
  const { expected, observed } = input;

  const expectedRecord = normalize(expected);
  const observedRecord = normalize(observed);

  const baseFields = {
    expected:           expectedRecord,
    observed:           observedRecord,
    actions_attempted:  [] as string[],
  };

  // Rule 4 — workflow_status === "failed"
  // Root cause: the deployment pipeline ran and explicitly failed. Inspect
  // logs before doing anything else, including before comparing IDs.
  if (observed.workflow_status === "failed") {
    return {
      ...baseFields,
      status:              "mismatch",
      classification:      "failed_action",
      can_escalate:        false,
      next_allowed_action: "inspect_deploy_logs",
      blocker:             null,
    };
  }

  // Rule 3 — workflow_status === "not_run"
  // Root cause: the deployment was expected but never triggered. The
  // deterministic next move is to run it.
  if (observed.workflow_status === "not_run") {
    return {
      ...baseFields,
      status:              "mismatch",
      classification:      "missing_action",
      can_escalate:        false,
      next_allowed_action: "trigger_deploy",
      blocker:             null,
    };
  }

  // Rule 2 — stale_state
  // We can only assert "stale" when both sides of a comparable field are
  // present and they disagree. Either deployment_id mismatch OR
  // commit mismatch is sufficient.
  const idBothPresent     = expected.deployment_id !== undefined
                         && observed.deployment_id !== undefined;
  const idMismatch        = idBothPresent
                         && expected.deployment_id !== observed.deployment_id;
  const commitBothPresent = expected.commit !== undefined
                         && observed.deployed_commit !== undefined;
  const commitMismatch    = commitBothPresent
                         && expected.commit !== observed.deployed_commit;

  if (idMismatch || commitMismatch) {
    return {
      ...baseFields,
      status:              "mismatch",
      classification:      "stale_state",
      can_escalate:        false,
      next_allowed_action: "inspect_deploy_pipeline",
      blocker:             null,
    };
  }

  // Rule 1 — healthy
  // Healthy requires:
  //   - every provided expected field that has an observed counterpart
  //     matches (handled above by the mismatch checks),
  //   - at least one positive verification signal,
  //   - no active failure indicator (http >= 400, missing observed where
  //     expected was provided).
  const idMatch         = idBothPresent
                       && expected.deployment_id === observed.deployment_id;
  const commitMatch     = commitBothPresent
                       && expected.commit === observed.deployed_commit;
  const httpProvided    = observed.http_status !== undefined;
  const httpOK          = httpProvided
                       && observed.http_status! >= 200
                       && observed.http_status! < 300;
  const httpFail        = httpProvided && observed.http_status! >= 400;

  // If expected.deployment_id is provided but observed.deployment_id is
  // missing, we cannot verify — it's not healthy.
  const idUnverifiable     = expected.deployment_id !== undefined
                          && observed.deployment_id === undefined;
  const commitUnverifiable = expected.commit !== undefined
                          && observed.deployed_commit === undefined;

  const allExpectedVerified = !idUnverifiable && !commitUnverifiable;
  const positiveSignal      = idMatch
                           || commitMatch
                           || observed.workflow_status === "success"
                           || httpOK;

  if (allExpectedVerified && positiveSignal && !httpFail) {
    return {
      ...baseFields,
      status:              "ok",
      classification:      "healthy",
      can_escalate:        true,
      next_allowed_action: null,
      blocker:             null,
    };
  }

  // Rule 5 — unknown
  // No deterministic classification possible. Escalation is allowed because
  // the system is honest about its inability to act. The blocker carries the
  // precise reason.
  return {
    ...baseFields,
    status:              "blocked",
    classification:      "unknown",
    can_escalate:        true,
    next_allowed_action: null,
    blocker:             buildBlocker(expected, observed),
  };
}

/**
 * Hard-enforce the "no human escalation before verification" invariant.
 *
 * Throws when `decision.can_escalate === false`. This is the bright line
 * that turns an advisory recommendation into an enforced control gate:
 * a caller cannot bypass `can_escalate` and ask a human for next steps;
 * the runtime stops them.
 *
 * Throws an `Error` (plain) so the callsite cannot accidentally catch a
 * domain-specific subclass and swallow the block.
 */
export function assertCanEscalate(decision: ControlDecision): void {
  if (decision.can_escalate === false) {
    throw new Error(
      `Human escalation blocked: deterministic next action exists: ${decision.next_allowed_action}`,
    );
  }
}

// ─── Helpers (pure) ───────────────────────────────────────────────────────────

/**
 * Filter out `undefined` values and sort keys so two equivalent inputs
 * produce structurally identical decision records.
 */
function normalize<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Construct a precise human-readable blocker string for the unknown case.
 * Reasons are concatenated in a stable order so the output is deterministic.
 */
function buildBlocker(
  expected: DeploymentCheckInput["expected"],
  observed: DeploymentCheckInput["observed"],
): string {
  const reasons: string[] = [];

  if (expected.deployment_id !== undefined && observed.deployment_id === undefined) {
    reasons.push("expected.deployment_id provided but observed.deployment_id missing");
  }
  if (expected.commit !== undefined && observed.deployed_commit === undefined) {
    reasons.push("expected.commit provided but observed.deployed_commit missing");
  }
  if (observed.http_status !== undefined && observed.http_status >= 400) {
    reasons.push(
      `observed.http_status=${observed.http_status} with insufficient corroborating signal`,
    );
  }
  if (observed.workflow_status === "running") {
    reasons.push("workflow_status=running; no determinate outcome yet");
  }
  if (observed.workflow_status === "unknown") {
    reasons.push("workflow_status=unknown; pipeline state cannot be read");
  }
  if (reasons.length === 0) {
    reasons.push("no comparable fields between expected and observed");
  }
  return reasons.join("; ");
}
