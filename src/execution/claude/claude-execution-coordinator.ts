/**
 * Claude Execution Coordinator — product seam wiring (Phase 8C).
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   The execution entry point for Claude Managed Agent requests.
 *
 *   Mirrors cursor-execution-coordinator.ts in structure:
 *
 *     prepareCursorExecution()    → prepareClaude Execution()
 *     deliverCursorExecution()    → deliverClaudeExecution()
 *
 *   Two phases. Same intent-separation as Cursor:
 *     Phase 1 (prepare): deterministic, synchronous, no side effects.
 *                        Builds the artifact, evaluates OCD, returns confirmation state.
 *     Phase 2 (deliver): async, requires H approval, dispatches to Claude API.
 *                        Calls the delivery gate with an already-approved artifact.
 *
 * ── OCD evaluation for Claude ──────────────────────────────────────────────────
 *
 *   Claude OCD is simpler than Cursor OCD at V1.
 *   The artifact already carries prohibitedPatterns from the mapper (ClaudeOCDPolicy).
 *
 *   The OCD check fires a conflict when parsedChange.filePath matches any
 *   prohibitedPattern glob. This surfaces the conflict to H before delivery.
 *   The delivery gate independently enforces prohibitedPatterns at delivery time
 *   (defense-in-depth: gate is the hard block, OCD is the early warning).
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a scheduler       — does not queue or retry
 *   NOT an OCD authority  — OCD fires conflicts; this surfaces them
 *   NOT a decision maker  — all decisions flow from intake + OCD + H approval
 *   NOT autonomous        — deliverClaudeExecution() requires an approved artifact
 *
 * ── Dependency direction ───────────────────────────────────────────────────────
 *
 *   Coordinator imports: intake types, claude module (all phases).
 *   Claude module NEVER imports this coordinator.
 *   Present layer NEVER imports this coordinator.
 *
 * ── Authority invariants preserved ────────────────────────────────────────────
 *
 *   - mode === "execute" is the only intake mode that opens Phase 1.
 *   - eligibility === "approved_for_agent" is the only state that opens Phase 2.
 *   - Raw input never crosses to Claude (enforced by ClaudeAgentHandoffArtifact shape).
 *   - executionDomain is derived once in buildClaudeHandoffArtifact (A1).
 *   - OCD fires conflicts; this surfaces them — never overrides them.
 *   - H approval is explicit (approveClaudeArtifact before deliverClaudeExecution).
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */

import type { IntakeResult }     from "../../intake/types.js";
import type { ReplaceChange }    from "../../understand/interpretation/types.js";
// This coordinator only ever receives ReplaceChange (FS ops bypass session pipeline entirely).
type ParsedChange = ReplaceChange;
import { matchesGlob }           from "../../cursor/glob-matcher.js";
import {
  buildClaudeHandoffArtifact,
} from "../../claude/artifact-mapper.js";
import type {
  ClaudeAgentHandoffArtifact,
  ClaudeOCDPolicy,
  ClaudeScopeQuestion,
  ClaudeToolPolicy,
  ModelAdvisoryPosition,
  ModelAdvisoryRecord,
} from "../../claude/index.js";
import type { ClaudeAgentPlugin }   from "../../claude/delivery-gate.js";
import { ClaudeDeliveryGate }       from "../../claude/delivery-gate.js";
import type { ClaudeGateDeps }      from "../../claude/delivery-gate.js";

// ─── Phase 1: Preparation result ─────────────────────────────────────────────

/**
 * ClaudePreparationResult — returned by prepareClaudeExecution().
 *
 *   "ready_for_confirmation"  OCD cleared. Artifact awaits H approval.
 *   "conflict_detected"       OCD fired a conflict. H must review + acceptConflict before approving.
 *   "not_execute"             intakeResult.mode was not "execute". No artifact produced.
 */
export type ClaudePreparationResult =
  | {
      readonly kind:     "ready_for_confirmation";
      readonly artifact: ClaudeAgentHandoffArtifact;
      readonly display:  ClaudePreparationDisplay;
    }
  | {
      readonly kind:     "conflict_detected";
      readonly artifact: ClaudeAgentHandoffArtifact;
      readonly display:  ClaudePreparationDisplay;
    }
  | {
      readonly kind:   "not_execute";
      readonly reason: string;
    };

/**
 * ClaudePreparationDisplay — consumer-ready strings for the Phase 1 result.
 *
 *   headline    — "Ready to delegate" / "Conflict detected"
 *   summary     — task description (from taskSpec.summary)
 *   targetFile  — the proposed target file from parsedChange, if known
 *   conflicts   — human-readable OCD conflict messages; empty when cleared
 */
export type ClaudePreparationDisplay = {
  readonly headline:   string;
  readonly summary:    string;
  readonly targetFile: string | null;
  readonly conflicts:  readonly string[];
};

// ─── Phase 2: Delivery result ─────────────────────────────────────────────────

/**
 * ClaudeExecutionResult — returned by deliverClaudeExecution().
 *
 *   "accepted"                       Claude accepted the task and started a session.
 *   "refused_due_to_scope"           Claude needs H to clarify scope.
 *   "refused_due_to_execution_error" Claude could not proceed (network, auth, session error).
 *   "blocked_ineligible"             Artifact not approved. Caller error.
 *   "blocked_tool_policy"            Tool policy violation (networkAccess not "deny", etc.).
 *   "blocked_persistence_failure"    Handoff provenance could not be recorded.
 */
export type ClaudeExecutionResult =
  | {
      readonly kind:      "accepted";
      readonly deliveryId: string;
      readonly sessionId:  string;
      readonly display:    ClaudeExecutionDisplay;
    }
  | {
      readonly kind:          "refused_due_to_scope";
      readonly deliveryId:    string;
      readonly scopeQuestion: ClaudeScopeQuestion;
      readonly display:       ClaudeExecutionDisplay;
    }
  | {
      /**
       * P3 Phase 2: the model emitted structured advisory position(s) and did
       * NOT execute. `positions` carries the gate-validated, durably persisted
       * evidence records (ucp.model_advisory.v1). The session layer parks on
       * this result; it is never an acceptance.
       */
      readonly kind:       "advisory";
      readonly deliveryId: string;
      readonly positions:  readonly ModelAdvisoryRecord[];
      readonly display:    ClaudeExecutionDisplay;
    }
  | {
      /**
       * P5 V1: every returned advisory was a reassertion of a retired
       * position. Recorded; not standing; not a park.
       */
      readonly kind:          "retired_reassertion";
      readonly deliveryId:    string;
      readonly reassertions:  readonly ModelAdvisoryRecord[];
      readonly display:       ClaudeExecutionDisplay;
    }
  | {
      readonly kind:      "refused_due_to_execution_error";
      readonly deliveryId: string;
      readonly errorCode:  string;
      readonly detail:     string;
      readonly display:    ClaudeExecutionDisplay;
    }
  | {
      readonly kind:    "blocked_ineligible";
      readonly display: ClaudeExecutionDisplay;
    }
  | {
      readonly kind:    "blocked_tool_policy";
      readonly reason:  string;
      readonly display: ClaudeExecutionDisplay;
    }
  | {
      readonly kind:    "blocked_persistence_failure";
      readonly reason:  string;
      readonly display: ClaudeExecutionDisplay;
    };

/**
 * ClaudeExecutionDisplay — consumer-ready strings for the Phase 2 result.
 */
export type ClaudeExecutionDisplay = {
  readonly verdict:  "accepted" | "refused" | "blocked";
  readonly headline: string;
  readonly note:     string | null;
};

// ─── Phase 1: prepareClaudeExecution ──────────────────────────────────────────

/**
 * Build and OCD-evaluate a ClaudeAgentHandoffArtifact from an IntakeResult.
 *
 * Returns a preparation result describing what will happen and whether OCD
 * has any conflicts. Synchronous and side-effect-free.
 *
 * @param intakeResult  Output of runIntake(). Must have mode === "execute".
 * @param intentId      UCP envelope id of the intent.
 * @param responseId    UCP envelope id of the response.
 * @param policy        OCD policy (alwaysProhibitedGlobs, writeSafeGlobs).
 * @param toolPolicy    Tool policy (allowedTools, networkAccess, filesystemMode).
 * @param parsedChange  Optional: structured change parsed from the input.
 */
export function prepareClaudeExecution(
  intakeResult: IntakeResult,
  intentId:     string,
  responseId:   string,
  policy:       ClaudeOCDPolicy,
  toolPolicy:   ClaudeToolPolicy,
  parsedChange?: ParsedChange,
): ClaudePreparationResult {
  if (intakeResult.mode !== "execute") {
    return {
      kind:   "not_execute",
      reason: `Cannot prepare Claude execution for mode "${intakeResult.mode}". Only "execute" mode is valid.`,
    };
  }

  const artifact = buildClaudeHandoffArtifact(
    intakeResult, intentId, responseId, policy, toolPolicy, parsedChange,
  );

  const conflicts = evaluateClaudeOCD(artifact, policy, parsedChange);
  const display   = formatPreparationDisplay(artifact, conflicts);

  if (conflicts.length > 0) {
    return { kind: "conflict_detected", artifact, display };
  }

  return { kind: "ready_for_confirmation", artifact, display };
}

// ─── Phase 2: deliverClaudeExecution ──────────────────────────────────────────

/**
 * Deliver an already-approved ClaudeAgentHandoffArtifact through the delivery gate.
 *
 * Call this after H has called approveClaudeArtifact() on the prepared artifact.
 *
 * @param approvedArtifact  A ClaudeAgentHandoffArtifact with eligibility: "approved_for_agent".
 * @param plugin            The transport adapter (ClaudeApiAdapter or stub).
 * @param storeDir          Absolute path to the UCP store directory.
 * @param deps              Optional: injectable persistence fns for testing.
 * @param priorAdvisories   Optional (P3 Phase 2): advisory positions the human
 *                          has explicitly superseded for this artifact, carried
 *                          into the re-delivery request as informational context.
 */
export async function deliverClaudeExecution(
  approvedArtifact: ClaudeAgentHandoffArtifact,
  plugin:           ClaudeAgentPlugin,
  storeDir:         string,
  deps?:            ClaudeGateDeps,
  priorAdvisories?: readonly ModelAdvisoryPosition[],
  retired?: {
    readonly retiredAdvisories: readonly import("../../claude/types.js").RetiredAdvisoryContext[];
    readonly retiredPositions: readonly import("../../claude/objection-retirement.js").RetiredPositionRef[];
  },
): Promise<ClaudeExecutionResult> {
  const gate   = new ClaudeDeliveryGate(plugin, storeDir, deps);
  const result = await gate.deliver(
    approvedArtifact,
    {
      ...(priorAdvisories !== undefined && priorAdvisories.length > 0
        ? { priorAdvisories }
        : {}),
      ...(retired !== undefined
        ? {
            retiredAdvisories: retired.retiredAdvisories,
            retiredPositions: retired.retiredPositions,
          }
        : {}),
    },
  );

  switch (result.outcome) {
    case "accepted":
      return {
        kind:       "accepted",
        deliveryId: result.deliveryId,
        sessionId:  result.sessionId,
        display: {
          verdict:  "accepted",
          headline: "Claude session started.",
          note:     `Session ID: ${result.sessionId}`,
        },
      };

    case "refused_due_to_scope":
      return {
        kind:          "refused_due_to_scope",
        deliveryId:    result.deliveryId,
        scopeQuestion: result.scopeQuestion,
        display: {
          verdict:  "refused",
          headline: "Claude needs scope clarification.",
          note:     result.scopeQuestion.explanation,
        },
      };

    case "advisory":
      return {
        kind:       "advisory",
        deliveryId: result.deliveryId,
        positions:  result.positions,
        display: {
          verdict:  "refused",
          headline: "Claude recorded an advisory position about this action.",
          note:     `${result.positions.length} position(s) recorded. The action is paused pending a human decision.`,
        },
      };

    case "retired_reassertion":
      return {
        kind:         "retired_reassertion",
        deliveryId:   result.deliveryId,
        reassertions: result.reassertions,
        display: {
          verdict:  "refused",
          headline: "Retired model position reasserted — recorded, not standing.",
          note:     `${result.reassertions.length} reassertion(s) recorded. The task is not parked.`,
        },
      };

    case "refused_due_to_execution_error":
      return {
        kind:       "refused_due_to_execution_error",
        deliveryId: result.deliveryId,
        errorCode:  result.errorCode,
        detail:     result.message,
        display: {
          verdict:  "refused",
          headline: "Claude could not complete the task.",
          note:     result.message,
        },
      };

    case "blocked_ineligible":
      return {
        kind: "blocked_ineligible",
        display: {
          verdict:  "blocked",
          headline: "Delivery blocked: artifact not approved.",
          note:     result.reason,
        },
      };

    case "blocked_tool_policy":
      return {
        kind:   "blocked_tool_policy",
        reason: result.reason,
        display: {
          verdict:  "blocked",
          headline: "Delivery blocked: tool policy violation.",
          note:     result.reason,
        },
      };

    case "blocked_persistence_failure":
      return {
        kind:   "blocked_persistence_failure",
        reason: result.reason,
        display: {
          verdict:  "blocked",
          headline: "Delivery blocked: provenance could not be recorded.",
          note:     result.reason,
        },
      };
  }
}

// ─── OCD evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate OCD rules for the Claude artifact.
 *
 * V1 rules:
 *   CLAUDE_OCD_1 — parsedChange.filePath matches a prohibitedPattern
 *
 * Returns human-readable conflict messages. Empty array = no conflicts.
 */
function evaluateClaudeOCD(
  artifact:      ClaudeAgentHandoffArtifact,
  _policy:       ClaudeOCDPolicy,
  parsedChange?: ParsedChange,
): readonly string[] {
  const conflicts: string[] = [];

  if (!parsedChange?.filePath) return conflicts;

  for (const pattern of artifact.prohibitedPatterns) {
    if (matchesGlob(parsedChange.filePath, pattern)) {
      conflicts.push(
        `Target file "${parsedChange.filePath}" matches prohibited pattern "${pattern}". ` +
        `Editing this file requires explicit conflict acceptance.`,
      );
      break;  // one conflict message per file is enough
    }
  }

  return conflicts;
}

// ─── Display formatting ───────────────────────────────────────────────────────

function formatPreparationDisplay(
  artifact:  ClaudeAgentHandoffArtifact,
  conflicts: readonly string[],
): ClaudePreparationDisplay {
  const hasConflict = conflicts.length > 0;
  const targetFile  = artifact.allowedFiles[0] ?? null;

  return {
    headline:   hasConflict ? "Conflict detected. Review before approving." : "Ready to delegate to Claude.",
    summary:    artifact.taskSpec.summary,
    targetFile,
    conflicts,
  };
}
