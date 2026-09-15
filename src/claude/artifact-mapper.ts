/**
 * Claude artifact mapper — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   Translates an IntakeResult (mode === "execute") into a ClaudeAgentHandoffArtifact
 *   with eligibility: "pending_confirmation" and initial scope + tool constraints.
 *
 *   This is the ONLY place that produces executionDomain.
 *   INVARIANT (A1): executionDomain is derived here from InterpretationResult or
 *   IntentInterpretation category. No downstream layer may re-classify it.
 *
 * ── What this mapper does ─────────────────────────────────────────────────────
 *
 *   1. Derives executionDomain from the interpretation category.
 *   2. Builds taskSpec from interpretation summary + parsedChange (if present).
 *   3. Sets initial allowedFiles = [parsedChange.filePath] or [].
 *   4. Sets initial prohibitedPatterns from OCD policy (defensive defaults).
 *   5. Sets allowedTools from the provided tool policy.
 *   6. Sets eligibility = "pending_confirmation".
 *   7. Sets ocdClearance = "clear" (OCD evaluator updates this separately).
 *
 * ── What this mapper does NOT do ──────────────────────────────────────────────
 *
 *   - Does not read the filesystem
 *   - Does not call the Claude API
 *   - Does not set eligibility to "approved_for_agent" (only H does that)
 *   - Does not validate H-provided paths (delivery gate's job)
 *   - Does not re-classify executionDomain after building (A1)
 *
 * ── CONSTRUCTION RULE: undefined-free payloads ────────────────────────────────
 *
 *   All payload objects must be undefined-free per UCP protocol invariant.
 *   Optional fields are omitted entirely when absent. Never assigned undefined.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */

import type { IntakeResult }                      from "../intake/types.js";
import type { ApprovedEffectiveBind, InterpretationResult, ReplaceChange } from "../understand/interpretation/types.js";
// This mapper only ever receives ReplaceChange (FS ops bypass the session/artifact pipeline).
type ParsedChange = ReplaceChange;
import type { IntentInterpretationCategory }       from "../understand/intent-interpretation/types.js";
import { hashObject }                              from "../ucp/hashes.js";
import type {
  ClaudeAgentHandoffArtifact,
  ClaudeHandoffEligibility,
  ClaudeExecutionDomain,
  ClaudeTaskSpec,
  ClaudeToolPolicy,
} from "./types.js";

// ─── OCD policy shape ─────────────────────────────────────────────────────────

/**
 * ClaudeOCDPolicy — the policy inputs for scope constraint building.
 *
 * Mirrors CursorOCDPolicy but applies to the Claude seam.
 */
export type ClaudeOCDPolicy = {
  /** Globs that are always prohibited regardless of allowedFiles. */
  readonly alwaysProhibitedGlobs: readonly string[];
  /** Globs that are safe to write within. Empty = no positive restriction. */
  readonly writeSafeGlobs:        readonly string[];
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the initial ClaudeAgentHandoffArtifact from an IntakeResult.
 *
 * PRECONDITION: intake.mode === "execute". Caller must verify this.
 *
 * @param intake       The completed intake result (mode must be "execute").
 * @param intentId     The ucp.intent.v1 envelope id.
 * @param responseId   The ucp.response.v1 envelope id.
 * @param policy       The OCD policy for scope constraint building.
 * @param toolPolicy   The tool policy (allowedTools, networkAccess, filesystemMode).
 * @param parsedChange Optional parsed change from a structured edit command.
 */
export function buildClaudeHandoffArtifact(
  intake:        IntakeResult,
  intentId:      string,
  responseId:    string,
  policy:        ClaudeOCDPolicy,
  toolPolicy:    ClaudeToolPolicy,
  parsedChange?: ParsedChange,
): ClaudeAgentHandoffArtifact {
  // Derive executionDomain (A1 — mapper only)
  const executionDomain = deriveExecutionDomain(intake, parsedChange);

  // Build taskSpec
  const taskSpec = buildTaskSpec(intake, parsedChange);

  // Initial allowedFiles: [parsedChange.filePath] when available, else []
  const allowedFiles: string[] =
    parsedChange?.filePath ? [parsedChange.filePath] : [];

  // Prohibited patterns: always-prohibited globs from OCD policy
  const prohibitedPatterns = [...policy.alwaysProhibitedGlobs];

  // Artifact content fields for deterministic id
  const content = {
    mode:               "execute" as const,
    executionDomain,
    taskSpec,
    allowedFiles,
    prohibitedPatterns,
    allowedTools:       [...toolPolicy.allowedTools],
    toolPolicy:         { ...toolPolicy },
    ocdClearance:       "clear" as const,
    eligibility:        "pending_confirmation" as ClaudeHandoffEligibility,
    intentId,
    responseId,
  };

  const artifactId = hashObject(content);

  return {
    artifactId,
    ...content,
  };
}

/**
 * Approve the artifact — transitions eligibility from "pending_confirmation"
 * to "approved_for_agent". Records the approval timestamp.
 *
 * H is the only actor that may call this. Called by the product session on
 * H's explicit approval action.
 */
export function approveClaudeArtifact(
  artifact: ClaudeAgentHandoffArtifact,
  at:       number = Date.now(),
): ClaudeAgentHandoffArtifact {
  const updated = {
    ...artifact,
    eligibility: "approved_for_agent" as ClaudeHandoffEligibility,
    approvedAt:  at,
  };
  return { ...updated, artifactId: hashObject(omitId(updated)) };
}

/**
 * Narrow the artifact's allowed files to a subset.
 *
 * H may narrow (remove entries) but not widen (add new paths).
 * The gate enforces this at delivery; this function enforces monotonicity
 * structurally by filtering the current allowedFiles.
 *
 * Returns a new artifact with updated allowedFiles and a recomputed id.
 */
export function narrowClaudeArtifactScope(
  artifact:     ClaudeAgentHandoffArtifact,
  allowedFiles: readonly string[],
): ClaudeAgentHandoffArtifact {
  const updated = {
    ...artifact,
    eligibility:  "pending_confirmation" as ClaudeHandoffEligibility,
    allowedFiles: [...allowedFiles],
    approvedAt:   undefined,
  };
  // Remove approvedAt (undefined-free: omit the field)
  const { approvedAt: _dropped, ...rest } = updated;
  void _dropped;
  return { ...rest, artifactId: hashObject(omitId(rest)) };
}

/** Attach a pre-approval observation. No-op on an already-approved artifact. */
export function bindClaudeArtifactEffectiveReceiver(
  artifact: ClaudeAgentHandoffArtifact,
  bind: ApprovedEffectiveBind,
  filePath?: string,
): ClaudeAgentHandoffArtifact {
  const parsedChange = artifact.taskSpec.parsedChange;
  if (parsedChange === undefined || artifact.eligibility === "approved_for_agent") return artifact;
  const nextParsed = {
    ...parsedChange,
    ...(filePath !== undefined ? { filePath } : {}),
    approvedEffective: bind,
  };
  const taskSpec = { ...artifact.taskSpec, parsedChange: nextParsed };
  const { approvedAt: _approvedAt, ...pending } = {
    ...artifact,
    taskSpec,
    eligibility: "pending_confirmation" as ClaudeHandoffEligibility,
  };
  void _approvedAt;
  return { ...pending, artifactId: hashObject(omitId(pending)) };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Derive executionDomain from the intake result.
 *
 * A1 INVARIANT: this function is the single derivation point.
 * No downstream layer may re-classify the returned value.
 *
 * Mapping from interpretation category:
 *   visual_color, text_change → code_edit
 *   config_change             → code_edit
 *   workflow_operation        → ops_task
 *   unknown (execute mode)    → code_edit (safe default for structured edits)
 *
 * When no interpretation category is available (no bridge, no change interp),
 * defaults to "code_edit" as the conservative choice for mode === "execute".
 */
function deriveExecutionDomain(
  intake:        IntakeResult,
  parsedChange?: ParsedChange,
): ClaudeExecutionDomain {
  // If a structured change was parsed, it's always a code edit
  if (parsedChange) return "code_edit";

  // Use change interpretation category when available
  const changeCategory = (intake.interpretation as InterpretationResult | undefined)?.category;
  if (changeCategory) {
    return mapCategory(changeCategory);
  }

  // Use intent interpretation category when available
  const intentCategory = intake.guidance?.interpretation?.category as IntentInterpretationCategory | undefined;
  if (intentCategory) {
    return mapCategory(intentCategory);
  }

  // Default: conservative code_edit for execute mode
  return "code_edit";
}

function mapCategory(category: string): ClaudeExecutionDomain {
  switch (category) {
    case "visual_color":
    case "text_change":
    case "config_change":
      return "code_edit";
    case "workflow_operation":
      return "ops_task";
    default:
      return "code_edit";
  }
}

function buildTaskSpec(
  intake:        IntakeResult,
  parsedChange?: ParsedChange,
): ClaudeTaskSpec {
  const interpretation = intake.interpretation as InterpretationResult | undefined;
  const intentInterp   = intake.guidance?.interpretation;

  const category = interpretation?.category
    ?? intentInterp?.category
    ?? "unknown";

  const summary = interpretation?.summary
    ?? intentInterp?.summary
    ?? intake.reason;

  if (parsedChange) {
    // Undefined-free: only include parsedChange fields that are present
    const pc: {
      filePath?: string;
      oldValue?: string;
      newValue?: string;
      approvedEffective?: ApprovedEffectiveBind;
    } = {};
    if (parsedChange.filePath) pc.filePath = parsedChange.filePath;
    if (parsedChange.oldValue) pc.oldValue = parsedChange.oldValue;
    if (parsedChange.newValue) pc.newValue = parsedChange.newValue;
    if (parsedChange.approvedEffective) pc.approvedEffective = parsedChange.approvedEffective;
    return { category, summary, parsedChange: pc };
  }

  return { category, summary };
}

function omitId(
  artifact: Omit<ClaudeAgentHandoffArtifact, "artifactId">,
): Omit<ClaudeAgentHandoffArtifact, "artifactId"> {
  return artifact;
}
