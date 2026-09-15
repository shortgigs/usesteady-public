/**
 * ControlEnvelope — drift prevention gate for agent build requests.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 *
 *   A ControlEnvelope wraps every coding/agent build request and must be
 *   compiled before any file is written. It is a meta-governance layer:
 *   it governs how UseSteady is built by agents, not how users run workflows.
 *
 *   The existing intake/present/UCP pipeline governs end-user workflow requests.
 *   ControlEnvelope governs requests like "Build Workspace Entry Screen."
 *
 * ── Enforcement contract ─────────────────────────────────────────────────────
 *
 *   approval.status === "blocked"  →  no code may be written, no file touched
 *   approval.status === "pending"  →  human must explicitly approve the contract
 *   approval.status === "approved" →  execution may begin
 *
 *   There is no "continue anyway" path in V1 normal mode.
 *
 * ── V1 scope ─────────────────────────────────────────────────────────────────
 *
 *   drift.mode === "forbidden_term_scan" is the only drift detection strategy
 *   in V1. Full ownership graphing, semantic roadmap parsing, and architectural
 *   collision detection are deferred to future versions.
 *
 * ── Invariants ───────────────────────────────────────────────────────────────
 *
 *   1. plannedChanges.summary must never be empty. An agent that cannot state
 *      what it will do must not proceed. An empty summary forces
 *      approval.status = "blocked" with reason "no_plan_summary".
 *
 *   2. Any non-empty drift.conflicts forces approval.status = "blocked".
 *
 *   3. drift.mode is always "forbidden_term_scan" in V1. Do not change this
 *      to a different string value in V1 code paths.
 *
 * See: docs/control-envelope-v1-spec.md
 */

// ─── Core type ────────────────────────────────────────────────────────────────

export type ControlEnvelope = {
  /**
   * Unique identifier for this envelope. Callers may use crypto.randomUUID()
   * or any stable ID scheme. Not content-addressed in V1.
   */
  requestId: string;

  /**
   * Who or what compiled this envelope.
   * "cursor_rule"  — compiled inside a Cursor agent session via the rule
   * "manual"       — compiled by a human or CLI tool directly
   * "other_agent"  — compiled by a non-Cursor automated agent
   */
  source: "cursor_rule" | "manual" | "other_agent";

  /** Current PI + Iteration name derived from ROADMAP.md. */
  phase: string;

  /** The exact raw request as submitted by the user or agent. */
  rawRequest: string;

  /**
   * Layer 1 — Intent classification.
   * Classifies the request type. Does NOT choose runtime or architecture.
   */
  intent: {
    /**
     * High-level class of the request.
     * Examples: "ui_feature", "api_change", "refactor", "docs", "config"
     */
    intentClass: string;
    /** Specific target within the class, e.g. "workspace_entry". */
    target?: string | undefined;
    /** Stated user goal in plain language. */
    goal?: string | undefined;
  };

  /**
   * Layer 2 — Active constraints.
   * Phase/roadmap constraints attached to this request before planning.
   */
  constraints: {
    /** The full list of active constraints for the current phase. */
    active: string[];
    /** Where the constraints came from. */
    source: "roadmap" | "baseline" | "manual";
  };

  /**
   * Layer 3 — Drift detection.
   * V1 strategy: forbidden_term_scan.
   *
   * Scans the proposed plan text for runtime/shell/architecture terms that
   * are forbidden in the current phase. Blocks immediately on any finding.
   */
  drift: {
    /** "clear" = no forbidden findings. "conflict" = at least one. */
    status: "clear" | "conflict";
    /** Human-readable description of each forbidden finding. */
    conflicts: string[];
    /**
     * Detection strategy used.
     * Always "forbidden_term_scan" in V1.
     */
    mode: "forbidden_term_scan";
  };

  /**
   * Layer 4 — Explain-before-modify.
   * The concrete SYSTEM WILL block. Must never be empty.
   */
  plannedChanges: {
    /**
     * Plain-language list of what the agent will do.
     * Example: ["Add WorkspacePicker to LoadTab in ui/src/pages/WorkflowPage.tsx"]
     * INVARIANT: must not be empty. Empty → approval.status = "blocked".
     */
    summary: string[];
    /**
     * File paths that may be touched.
     * May be empty only if summary is a doc/config change with no file targets yet.
     */
    files: string[];
    /**
     * The specific forbidden terms found during drift detection.
     * Populated from drift.conflicts for display in the approval surface.
     */
    forbiddenFindings: string[];
  };

  /**
   * Layer 5 — Execution gate.
   * Execution may only begin if status is "approved".
   * "blocked" is terminal — no bypass path exists in V1.
   */
  approval: {
    status: "pending" | "approved" | "blocked";
    /**
     * Required when status === "blocked".
     * One of: "drift_conflict" | "no_plan_summary" | "constraint_violation"
     */
    reason?: string | undefined;
  };
};

// ─── Narrowing helpers ────────────────────────────────────────────────────────

/** True if the envelope is blocked and must not proceed to code generation. */
export function isBlocked(envelope: ControlEnvelope): boolean {
  return envelope.approval.status === "blocked";
}

/** True if all layers are green and human approval has been given. */
export function isApproved(envelope: ControlEnvelope): boolean {
  return envelope.approval.status === "approved";
}

/** True if the envelope has been compiled but not yet approved or blocked. */
export function isPending(envelope: ControlEnvelope): boolean {
  return envelope.approval.status === "pending";
}

/** True if drift was detected — shorthand for checking conflicts. */
export function hasDriftConflict(envelope: ControlEnvelope): boolean {
  return envelope.drift.status === "conflict";
}
