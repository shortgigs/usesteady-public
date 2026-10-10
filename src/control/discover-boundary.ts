// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/control/discover-boundary.ts
 *
 * UseSteady Control Gate v0 — Boundary Discovery Primitive.
 *
 * Companion to `verify-and-resolve.ts` (PR #274). Where verifyAndResolve
 * answers
 *
 *     "Is the system in expected state, and what is the next action?"
 *
 * this primitive answers the next question:
 *
 *     "Once an action is proposed, what is its natural scope and class?"
 *
 * It does NOT decide whether the action is allowed. It does NOT enforce
 * anything. It does NOT call out. It is a pure structural transformation:
 *
 *     (observed action + context)  →  proposed boundary
 *
 * A future policy primitive (out of scope for this PR) will consume the
 * proposed boundary and decide enforcement. Today this module only
 * surfaces the candidate.
 *
 * ── Scope (v0) ────────────────────────────────────────────────────────────────
 *
 *   - Pure function. No I/O. No spawn. No network.
 *   - No CLI surface. No execution. No policy enforcement.
 *   - Closed enums for action_class and scope.kind.
 *   - Output is byte-deterministic for the same input (sorted keys,
 *     hash-derived boundary_id).
 *
 * ── Discipline ────────────────────────────────────────────────────────────────
 *
 *   - The constraint string is template-bound by action_class. It does NOT
 *     change based on context — context shapes the SCOPE, not the
 *     constraint TEXT. This keeps the primitive resistant to drift into
 *     enforcement language.
 *   - The rationale is a verbatim restatement of the inputs that drove the
 *     classification; no inference, no summarization.
 */

import { createHash } from "node:crypto";

// ─── Public types ─────────────────────────────────────────────────────────────

export type BoundaryAction = {
  /** The action being observed (e.g. "inspect_deploy_pipeline"). */
  type:    string;
  /** Optional target identifier (e.g. a path, file, or resource id). */
  target?: string;
};

export type BoundaryContext = {
  /**
   * Where the action originated. Constrained to a closed enum so the
   * primitive cannot accept ad-hoc strings that drift over time.
   */
  triggered_by?:   "verify_and_resolve" | "agent_initiated" | "external" | "unknown";
  /**
   * Optional classification carried over from verify-and-resolve. Useful
   * for upstream pipelines but not required.
   */
  classification?: "healthy" | "stale_state" | "missing_action" | "failed_action" | "unknown";
  pr?:             number;
  branch?:         string;
  commit?:         string;
  deployment_id?:  string;
};

export type BoundaryActionClass =
  | "inspect"
  | "trigger"
  | "mutate"
  | "escalate"
  | "unknown";

export type BoundaryScopeKind =
  | "deployment"
  | "branch"
  | "pipeline"
  | "repo"
  | "global"
  | "unknown";

export type BoundaryScope = {
  kind:       BoundaryScopeKind;
  identifier: string | null;
};

export type ProposedBoundary = {
  /** Deterministic hash over (action, context). Same input → same id. */
  boundary_id:         string;
  action_class:        BoundaryActionClass;
  scope:               BoundaryScope;
  /** Class-bound constraint text. Does NOT vary with context. */
  proposed_constraint: string;
  /** Verbatim restatement of the inputs that drove classification. */
  rationale:           string;
};

export type DiscoverInput = {
  action:  BoundaryAction;
  context: BoundaryContext;
};

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Discover the proposed boundary for an observed action in a given
 * context. Pure function. Produces a candidate; never enforces.
 */
export function discoverBoundary(input: DiscoverInput): ProposedBoundary {
  const action_class = classifyAction(input.action.type);
  const scope        = deriveScope(input.action, input.context);
  const constraint   = constraintFor(action_class);
  const rationale    = buildRationale(input, action_class, scope);
  const boundary_id  = deriveBoundaryId(input);

  return {
    boundary_id,
    action_class,
    scope,
    proposed_constraint: constraint,
    rationale,
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Map an action type string to an action_class. The matching is prefix-
 * based and uses a closed mapping table; unknown actions resolve to
 * "unknown" rather than being inferred.
 */
function classifyAction(type: string): BoundaryActionClass {
  const lc = type.toLowerCase();
  // Each prefix list is exhaustive for v0. A new action class requires
  // an explicit additive change here, not inference.
  if (
    lc.startsWith("inspect_") ||
    lc.startsWith("read_")    ||
    lc.startsWith("view_")    ||
    lc.startsWith("get_")
  ) return "inspect";

  if (
    lc.startsWith("trigger_") ||
    lc.startsWith("rerun_")   ||
    lc.startsWith("redeploy") ||
    lc.startsWith("start_")   ||
    lc.startsWith("dispatch_")
  ) return "trigger";

  if (
    lc.startsWith("mutate_")  ||
    lc.startsWith("update_")  ||
    lc.startsWith("delete_")  ||
    lc.startsWith("write_")   ||
    lc.startsWith("create_")  ||
    lc.startsWith("modify_")
  ) return "mutate";

  if (
    lc.startsWith("escalate_") ||
    lc === "ask_human"         ||
    lc === "escalate"          ||
    lc.startsWith("notify_human")
  ) return "escalate";

  return "unknown";
}

/**
 * Derive the natural scope for an action. Precedence (most specific first):
 *
 *   1. context.deployment_id  → "deployment"
 *   2. context.branch         → "branch"
 *   3. context.pr             → "pipeline" (id = `pr/<n>`)
 *   4. action.target          → "repo"
 *   5. otherwise              → "unknown"
 *
 * The mapping is literal — no inference from action.type.
 */
function deriveScope(action: BoundaryAction, context: BoundaryContext): BoundaryScope {
  if (context.deployment_id !== undefined) {
    return { kind: "deployment", identifier: context.deployment_id };
  }
  if (context.branch !== undefined) {
    return { kind: "branch", identifier: context.branch };
  }
  if (context.pr !== undefined) {
    return { kind: "pipeline", identifier: `pr/${context.pr}` };
  }
  if (action.target !== undefined) {
    return { kind: "repo", identifier: action.target };
  }
  return { kind: "unknown", identifier: null };
}

/**
 * Class-bound constraint text. Bound to action_class so the primitive
 * cannot be coaxed into context-dependent enforcement language.
 */
function constraintFor(cls: BoundaryActionClass): string {
  switch (cls) {
    case "inspect":  return "read-only within scope";
    case "trigger":  return "may initiate within scope";
    case "mutate":   return "modifies state within scope";
    case "escalate": return "requests human review";
    case "unknown":  return "unclassified; further analysis required";
  }
}

/**
 * Build a verbatim rationale string. Each clause restates a fact present
 * in the input — no summarization, no inference.
 */
function buildRationale(
  input: DiscoverInput,
  cls:   BoundaryActionClass,
  scope: BoundaryScope,
): string {
  const parts: string[] = [];
  parts.push(`action_class=${cls} derived from action.type=${input.action.type}`);
  parts.push(`scope=${scope.kind} (identifier=${scope.identifier ?? "null"})`);
  if (input.context.triggered_by !== undefined) {
    parts.push(`triggered_by=${input.context.triggered_by}`);
  }
  if (input.context.classification !== undefined) {
    parts.push(`upstream_classification=${input.context.classification}`);
  }
  return parts.join("; ");
}

/**
 * Deterministic boundary id. SHA-256 over a sorted-key serialization of
 * the input, truncated to 12 hex characters. Same input → same id.
 */
function deriveBoundaryId(input: DiscoverInput): string {
  const canonical = JSON.stringify({
    action:  sortedKeys(input.action),
    context: sortedKeys(input.context),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function sortedKeys<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
