/**
 * Intrinsic phase templates — USESTEADY_WORKPLAN_GENERATION_V1
 *
 * Closed, curated sets per deliverable type. No F1–F4 forbidden classes.
 */

import type { DeliverableType, WorkPlanOperatorAction } from "./work-plan-types.js";

export type PhaseTemplateEntry = {
  readonly id: string;
  readonly action: string;
  readonly targetKey: string;
  readonly outcomeKey: string;
  readonly operatorAction: WorkPlanOperatorAction;
};

export type PhaseTemplate = {
  readonly deliverableType: DeliverableType;
  readonly phases: readonly PhaseTemplateEntry[];
  readonly goalPattern: (subject: string, goalVerb?: string) => string;
  readonly terminalOutcomePattern: (subject: string) => string;
};

const TARGET_LABELS: Record<string, string> = {
  participants:       "participants",
  sessions:             "sessions",
  report:               "characterization report",
  research_scope:       "research scope",
  methodology:          "evaluation methodology",
  initial_setup:        "initial research setup",
  research_plan:        "research plan artifact",
  current_state:        "current state",
  migration_phases:     "migration phases",
  scope_boundaries:     "scope boundaries",
  cutover_plan:         "cutover plan",
  capability_requirements: "capability requirements",
  capability_interface:  "capability interface",
  capability_scaffold:   "capability scaffold",
  integration_points:    "integration points",
  refactor_targets:      "refactor targets",
  planned_changes:       "planned changes",
  verification_approach: "verification approach",
  refactor_scope:        "refactor scope",
  directory_structure:   "directory structure",
  skeleton_files:        "skeleton files",
  baseline_content:      "baseline content",
  scaffold_layout:       "scaffold layout",
  goal_statement:        "goal scope",
  named_deliverable:     "deliverable scope",
  ordered_phases:        "phase scope",
  confirmed_scope:       "confirmed scope",
  investigation_question: "investigation question",
  evidence_sources:       "evidence sources",
  gathered_evidence:      "gathered evidence",
  findings_record:        "findings record",
};

function tpl(
  deliverableType: DeliverableType,
  phases: readonly PhaseTemplateEntry[],
  goal: (s: string, goalVerb?: string) => string,
  terminal: (s: string) => string,
): PhaseTemplate {
  return { deliverableType, phases, goalPattern: goal, terminalOutcomePattern: terminal };
}

export const PHASE_TEMPLATES: Record<DeliverableType, PhaseTemplate> = {
  characterization: tpl(
    "characterization",
    [
      { id: "char-recruit",  action: "recruit",  targetKey: "participants", outcomeKey: "participants_recruited", operatorAction: "approve" },
      { id: "char-run",      action: "run",      targetKey: "sessions",     outcomeKey: "sessions_recorded",      operatorAction: "approve" },
      { id: "char-score",    action: "score",    targetKey: "sessions",     outcomeKey: "sessions_scored",        operatorAction: "approve" },
      { id: "char-publish",  action: "publish",  targetKey: "report",       outcomeKey: "report_published",       operatorAction: "approve" },
    ],
    s => `Complete characterization of ${s}`,
    s => `Published characterization report for ${s}`,
  ),

  research_initiative: tpl(
    "research_initiative",
    [
      { id: "res-define",     action: "define",     targetKey: "research_scope", outcomeKey: "scope_confirmed",     operatorAction: "approve" },
      { id: "res-establish",  action: "establish",  targetKey: "methodology",    outcomeKey: "methodology_defined", operatorAction: "approve" },
      { id: "res-conduct",    action: "conduct",    targetKey: "initial_setup",  outcomeKey: "setup_scoped",        operatorAction: "approve" },
      { id: "res-document",   action: "document",   targetKey: "research_plan",  outcomeKey: "plan_defined",        operatorAction: "approve" },
    ],
    s => `Establish research initiative for ${s}`,
    s => `Research plan artifact defined for ${s}`,
  ),

  program_migration: tpl(
    "program_migration",
    [
      { id: "mig-assess",   action: "assess",   targetKey: "current_state",    outcomeKey: "state_documented",  operatorAction: "approve" },
      { id: "mig-plan",     action: "plan",     targetKey: "migration_phases", outcomeKey: "phases_defined",    operatorAction: "approve" },
      { id: "mig-validate", action: "validate", targetKey: "scope_boundaries", outcomeKey: "boundaries_set",    operatorAction: "approve" },
      { id: "mig-prepare",  action: "prepare",  targetKey: "cutover_plan",     outcomeKey: "cutover_drafted",   operatorAction: "approve" },
    ],
    s => `Plan migration program for ${s}`,
    s => `Cutover plan drafted for ${s}`,
  ),

  capability_setup: tpl(
    "capability_setup",
    [
      { id: "cap-define",     action: "define",     targetKey: "capability_requirements", outcomeKey: "requirements_documented", operatorAction: "approve" },
      { id: "cap-design",     action: "design",     targetKey: "capability_interface",    outcomeKey: "interface_scoped",      operatorAction: "approve" },
      { id: "cap-implement",  action: "implement",  targetKey: "capability_scaffold",     outcomeKey: "scaffold_defined",      operatorAction: "approve" },
      { id: "cap-verify",     action: "verify",     targetKey: "integration_points",      outcomeKey: "integration_identified",  operatorAction: "approve" },
    ],
    s => `Define capability setup for ${s}`,
    s => `Integration points identified for ${s}`,
  ),

  refactor_scope: tpl(
    "refactor_scope",
    [
      { id: "ref-identify", action: "identify", targetKey: "refactor_targets",      outcomeKey: "targets_identified", operatorAction: "approve" },
      { id: "ref-plan",     action: "plan",     targetKey: "planned_changes",       outcomeKey: "changes_planned",    operatorAction: "approve" },
      { id: "ref-define",   action: "define",   targetKey: "verification_approach", outcomeKey: "verification_set",   operatorAction: "approve" },
      { id: "ref-review",   action: "review",   targetKey: "refactor_scope",        outcomeKey: "scope_reviewed",     operatorAction: "approve" },
    ],
    s => `Plan refactor scope for ${s}`,
    s => `Refactor scope reviewed for ${s}`,
  ),

  structure_scaffold: tpl(
    "structure_scaffold",
    [
      { id: "scaf-define",   action: "define",  targetKey: "directory_structure", outcomeKey: "structure_defined", operatorAction: "approve" },
      { id: "scaf-create",   action: "create",  targetKey: "skeleton_files",      outcomeKey: "skeleton_scoped",   operatorAction: "approve" },
      { id: "scaf-add",      action: "add",     targetKey: "baseline_content",    outcomeKey: "baseline_planned",  operatorAction: "approve" },
      { id: "scaf-verify",   action: "verify",  targetKey: "scaffold_layout",     outcomeKey: "layout_verified",   operatorAction: "approve" },
    ],
    s => `Scaffold project structure for ${s}`,
    s => `Scaffold layout verified for ${s}`,
  ),

  planning: tpl(
    "planning",
    [
      { id: "plan-clarify", action: "clarify", targetKey: "goal_statement",    outcomeKey: "goal_confirmed",     operatorAction: "approve" },
      { id: "plan-define",  action: "define",  targetKey: "named_deliverable", outcomeKey: "deliverable_named",  operatorAction: "approve" },
      { id: "plan-sequence", action: "sequence", targetKey: "ordered_phases", outcomeKey: "phases_ordered",     operatorAction: "approve" },
      { id: "plan-confirm", action: "confirm", targetKey: "confirmed_scope",   outcomeKey: "scope_confirmed",    operatorAction: "approve" },
    ],
    (s, goalVerb = "Create") => `${goalVerb} ${s}`,
    s => `Work plan defined for ${s}`,
  ),

  // USESTEADY_ANALYSIS_SURFACE_IMPL_V1 — ratified S2: Analysis = specialized WorkPlan.
  // Completion artifact = Findings Record (Analysis Completion Rule: complete when the
  // stated question has an evidence-backed answer). Goal/terminal patterns here are the
  // understand_why defaults; the generator overrides per ask subtype.
  analysis_findings: tpl(
    "analysis_findings",
    [
      { id: "ana-scope",    action: "define",   targetKey: "investigation_question", outcomeKey: "question_fixed",      operatorAction: "approve" },
      { id: "ana-gather",   action: "gather",   targetKey: "evidence_sources",       outcomeKey: "evidence_gathered",   operatorAction: "approve" },
      { id: "ana-examine",  action: "examine",  targetKey: "gathered_evidence",      outcomeKey: "evidence_examined",   operatorAction: "approve" },
      { id: "ana-findings", action: "document", targetKey: "findings_record",        outcomeKey: "findings_documented", operatorAction: "approve" },
    ],
    s => `Produce an explanation of ${s}`,
    s => `Findings documented: an evidence-backed answer to ${s}`,
  ),
};

const OUTCOME_LABELS: Record<string, string> = {
  participants_recruited:  "Participants identified for sessions",
  sessions_recorded:         "Sessions completed and recorded",
  sessions_scored:           "Scores captured per rubric",
  report_published:          "Characterization report ready to publish",
  methodology_defined:       "Evaluation methodology defined",
  setup_scoped:              "Initial research setup scoped",
  plan_defined:              "Research plan artifact defined",
  state_documented:          "Current state documented",
  phases_defined:            "Migration phases defined",
  boundaries_set:            "Scope boundaries validated",
  cutover_drafted:           "Cutover plan drafted",
  requirements_documented:   "Requirements documented",
  interface_scoped:          "Interface design scoped",
  scaffold_defined:          "Scaffold structure defined",
  integration_identified:    "Integration points identified",
  targets_identified:        "Target files identified",
  changes_planned:           "Changes planned",
  verification_set:          "Verification approach defined",
  scope_reviewed:            "Scope reviewed before edits",
  structure_defined:         "Structure layout defined",
  skeleton_scoped:           "Skeleton files scoped",
  baseline_planned:          "Baseline content planned",
  layout_verified:           "Layout verified before paths",
  goal_confirmed:            "Goal scope confirmed",
  deliverable_named:         "Deliverable scope named",
  phases_ordered:            "Phases scoped",
  scope_confirmed:           "Scope confirmed",
  question_fixed:            "Investigation question fixed",
  evidence_gathered:         "Evidence sources gathered",
  evidence_examined:         "Evidence examined against the question",
  findings_documented:       "Findings record documented",
};

/** Forbidden-class action keywords (F1–F4) — must never appear in templates. */
export const FORBIDDEN_TEMPLATE_ACTIONS = [
  "hire", "assign", "schedule", "estimate", "track", "monitor", "maintain",
  "dashboard", "database", "deploy",
] as const;

export function resolveTarget(targetKey: string, subject: string): string {
  const base = TARGET_LABELS[targetKey] ?? targetKey;
  if (targetKey === "participants" || targetKey === "sessions") {
    return `${base} for ${subject}`;
  }
  return `${base} — ${subject}`;
}

export function resolveOutcome(outcomeKey: string): string {
  return OUTCOME_LABELS[outcomeKey] ?? outcomeKey;
}

export function getTemplate(type: DeliverableType): PhaseTemplate {
  return PHASE_TEMPLATES[type];
}
