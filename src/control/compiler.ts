/**
 * ControlEnvelope compiler — assembles all five layers into a single envelope.
 *
 * ── Responsibility ────────────────────────────────────────────────────────────
 *
 *   compileControlEnvelope() is the single entry point for the ControlEnvelope
 *   pipeline. It runs layers 1–5 in sequence and returns a fully populated
 *   ControlEnvelope.
 *
 *   It does NOT write files. It does NOT call an LLM. It does NOT make network
 *   requests. It is a pure synchronous function over its input arguments.
 *
 * ── Invariants enforced here ─────────────────────────────────────────────────
 *
 *   1. plannedChanges.summary must not be empty.
 *      Empty summary → approval.status = "blocked", reason = "no_plan_summary".
 *
 *   2. Any drift conflict → approval.status = "blocked", reason = "drift_conflict".
 *
 *   3. Blocking conditions are checked in order: summary empty first, then drift.
 *      Both conditions are always evaluated (fail-full reporting).
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   Cursor agents call this (conceptually) by filling in CompileInput and
 *   reading the returned ControlEnvelope. The Cursor rule in
 *   .cursor/rules/roadmap-discipline.mdc requires this to be shown before
 *   any code is written.
 *
 *   CLI / manual usage:
 *     import { compileControlEnvelope } from "./src/control/index.js";
 *     const envelope = compileControlEnvelope({ ... });
 *
 * See: docs/control-envelope-v1-spec.md
 */

import { randomUUID } from "node:crypto";
import type { ControlEnvelope } from "./types.js";
import { loadPhaseConstraints } from "./constraints.js";
import {
  detectForbiddenTermsInRequest,
  detectForbiddenTermsInPlan,
  toDriftField,
} from "./drift-detector.js";
import {
  canonicalizeForSafety,
  CanonicalizationError,
} from "../safety/canonicalize.js";

// ─── Input shape ──────────────────────────────────────────────────────────────

export type CompileInput = {
  /**
   * The exact raw request as submitted by the user or agent.
   * Used for Layer 1 (intent classification) and Layer 3 (early drift scan).
   */
  rawRequest: string;

  /**
   * Who is compiling this envelope.
   * Agents invoked via .cursor/rules should use "cursor_rule".
   */
  source: ControlEnvelope["source"];

  /**
   * Layer 1 — intent fields.
   * The agent must classify its own request before calling compileControlEnvelope.
   * These are not inferred automatically in V1.
   */
  intent: {
    intentClass: string;
    target?: string | undefined;
    goal?: string | undefined;
  };

  /**
   * Layer 4 — planned changes.
   * The agent must produce a concrete SYSTEM WILL summary before calling this.
   * An empty summary array will result in approval.status = "blocked".
   */
  plannedChanges: {
    /**
     * Plain-language list of what will be done.
     * Must not be empty. Example:
     *   ["Add WorkspacePicker to ui/src/pages/WorkflowPage.tsx"]
     */
    summary: string[];
    /**
     * File paths that may be touched. May be empty for pure-doc changes.
     */
    files: string[];
  };

  /**
   * Optional: absolute path to the workspace root.
   * Used to locate ROADMAP.md. Defaults to process.cwd().
   */
  workspaceRoot?: string | undefined;

  /**
   * Optional: caller-provided requestId.
   * If omitted, a random UUID is generated.
   */
  requestId?: string | undefined;
};

// ─── Compiler ─────────────────────────────────────────────────────────────────

/**
 * Compile a ControlEnvelope from a build request.
 *
 * Runs all five layers:
 *   1. Intent classification  — from CompileInput.intent (caller-provided)
 *   2. Constraint loading     — from ROADMAP.md via loadPhaseConstraints()
 *   3. Drift detection        — scans rawRequest + plannedChanges for forbidden terms
 *   4. Plan summary assembly  — from CompileInput.plannedChanges
 *   5. Approval gate          — blocks if summary empty or drift detected
 *
 * Returns a fully populated ControlEnvelope. Never throws.
 */
export function compileControlEnvelope(input: CompileInput): ControlEnvelope {
  const requestId = input.requestId ?? randomUUID();

  // ── Layer 2: load phase constraints ────────────────────────────────────────
  const phaseConstraints = loadPhaseConstraints(input.workspaceRoot);

  // ── Pre-Layer-3: input canonicalization ────────────────────────────────────
  // Canonicalize all text that flows into drift detection (NFKC + zero-width
  // strip + bidi strip). Detectors are unchanged; they receive canonical
  // strings. Original input is preserved in plannedChanges for audit.
  // Canonicalization failure is fail-closed: emit a blocked envelope with
  // no detector run.
  let canonRequest: string;
  let canonSummary: string[];
  let canonFiles: string[];
  try {
    canonRequest = canonicalizeForSafety(input.rawRequest);
    canonSummary = input.plannedChanges.summary.map(canonicalizeForSafety);
    canonFiles   = input.plannedChanges.files.map(canonicalizeForSafety);
  } catch (err) {
    const detail =
      err instanceof CanonicalizationError ? err.message : "unknown error";
    const failClosedDrift = toDriftField({
      status:    "conflict",
      conflicts: [`Input canonicalization failed: ${detail}`],
      mode:      "forbidden_term_scan",
    });
    return {
      requestId,
      source:     input.source,
      phase:      phaseConstraints.phase,
      rawRequest: input.rawRequest,
      intent: {
        intentClass: input.intent.intentClass,
        ...(input.intent.target !== undefined ? { target: input.intent.target } : {}),
        ...(input.intent.goal   !== undefined ? { goal:   input.intent.goal   } : {}),
      },
      constraints: {
        active: phaseConstraints.active,
        source: phaseConstraints.source,
      },
      drift: failClosedDrift,
      plannedChanges: {
        summary:           input.plannedChanges.summary,
        files:             input.plannedChanges.files,
        forbiddenFindings: failClosedDrift.conflicts,
      },
      approval: {
        status: "blocked",
        reason: "canonicalization_failed",
      },
    };
  }

  // ── Layer 3: drift detection ───────────────────────────────────────────────
  // Scan both the (canonicalized) raw request and the (canonicalized)
  // planned changes. Original strings are preserved on the envelope; only
  // the detector view is canonicalized.
  const requestScan = detectForbiddenTermsInRequest(canonRequest);
  const planScan    = detectForbiddenTermsInPlan(
    canonSummary,
    canonFiles,
  );

  // Merge all findings (deduplicate by message).
  const allConflicts = deduplicateConflicts([
    ...requestScan.conflicts,
    ...planScan.conflicts,
  ]);

  const driftResult = toDriftField({
    status:    allConflicts.length > 0 ? "conflict" : "clear",
    conflicts: allConflicts,
    mode:      "forbidden_term_scan",
  });

  // ── Layer 4: planned changes ───────────────────────────────────────────────
  const plannedChanges: ControlEnvelope["plannedChanges"] = {
    summary:          input.plannedChanges.summary,
    files:            input.plannedChanges.files,
    forbiddenFindings: allConflicts,
  };

  // ── Layer 5: approval gate ─────────────────────────────────────────────────
  // Evaluate all blocking conditions. Collect all reasons.
  const blockingReasons: string[] = [];

  if (input.plannedChanges.summary.length === 0) {
    blockingReasons.push("no_plan_summary");
  }
  if (driftResult.status === "conflict") {
    blockingReasons.push("drift_conflict");
  }

  const approval: ControlEnvelope["approval"] =
    blockingReasons.length > 0
      ? { status: "blocked", reason: blockingReasons.join(", ") }
      : { status: "pending" };

  // ── Assemble envelope ──────────────────────────────────────────────────────
  return {
    requestId,
    source:     input.source,
    phase:      phaseConstraints.phase,
    rawRequest: input.rawRequest,
    intent: {
      intentClass: input.intent.intentClass,
      ...(input.intent.target !== undefined ? { target: input.intent.target } : {}),
      ...(input.intent.goal   !== undefined ? { goal:   input.intent.goal   } : {}),
    },
    constraints: {
      active: phaseConstraints.active,
      source: phaseConstraints.source,
    },
    drift:          driftResult,
    plannedChanges,
    approval,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Format a ControlEnvelope as the canonical SYSTEM WILL display block.
 * Used by CLI tools and Cursor agents to render the contract before approval.
 *
 * Output format:
 *
 *   YOU ASKED
 *   <rawRequest>
 *
 *   SYSTEM WILL
 *   - <summary[0]>
 *   - <summary[1]>
 *
 *   FILES THAT MAY CHANGE
 *   - <files[0]>
 *
 *   CONSTRAINT CHECK
 *   - <constraint>
 *
 *   DRIFT CHECK: CLEAR | CONFLICT
 *   - <conflict[0]>          (only if conflict)
 *
 *   APPROVAL: PENDING | APPROVED | BLOCKED
 *   Reason: <reason>         (only if blocked)
 */
export function formatControlEnvelope(envelope: ControlEnvelope): string {
  const lines: string[] = [];

  lines.push("YOU ASKED");
  lines.push(envelope.rawRequest);
  lines.push("");

  lines.push("SYSTEM WILL");
  if (envelope.plannedChanges.summary.length === 0) {
    lines.push("  (no plan summary — blocked)");
  } else {
    for (const item of envelope.plannedChanges.summary) {
      lines.push(`  - ${item}`);
    }
  }
  lines.push("");

  if (envelope.plannedChanges.files.length > 0) {
    lines.push("FILES THAT MAY CHANGE");
    for (const f of envelope.plannedChanges.files) {
      lines.push(`  - ${f}`);
    }
    lines.push("");
  }

  lines.push("CONSTRAINT CHECK");
  for (const c of envelope.constraints.active) {
    lines.push(`  - ${c}`);
  }
  lines.push("");

  const driftLabel = envelope.drift.status === "conflict" ? "CONFLICT" : "CLEAR";
  lines.push(`DRIFT CHECK: ${driftLabel}`);
  for (const conflict of envelope.drift.conflicts) {
    lines.push(`  ! ${conflict}`);
  }
  lines.push("");

  const approvalLabel = envelope.approval.status.toUpperCase();
  lines.push(`APPROVAL: ${approvalLabel}`);
  if (envelope.approval.reason) {
    lines.push(`  Reason: ${envelope.approval.reason}`);
  }

  return lines.join("\n");
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function deduplicateConflicts(conflicts: string[]): string[] {
  return [...new Set(conflicts)];
}
