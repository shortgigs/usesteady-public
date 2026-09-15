/**
 * Runtime planning-review spec builder.
 * USESTEADY_RUNTIME_PLANNING_REVIEW_ROUTING_V1
 * USESTEADY_WORKPLAN_GENERATION_V1 — template-driven WorkPlan transform.
 *
 * Pure mapping: ConfirmedUnderstandingV1 -> WorkflowSpec with planningReview tasks.
 * No intake, no execute, no Portal review-draft builder import.
 */

import type { ConfirmedUnderstandingV1 } from "../portal-bridge/confirmed-understanding-handoff.js";
import type { WorkflowSpec } from "./types.js";
import type { WorkPlan } from "./work-plan-types.js";
import { generateWorkPlanFromConfirmed } from "./work-plan-generator.js";

function deriveNameFromIntent(intent: string): string {
  const trimmed = intent.trim();
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45).trim()}…`;
}

function headlineForDeliverableType(deliverableType: string): string {
  switch (deliverableType) {
    case "characterization":
      return "Work plan for your confirmed characterization — review phases before any work runs.";
    case "research_initiative":
      return "Work plan for your confirmed research initiative — no filesystem changes yet.";
    case "program_migration":
      return "Work plan for your confirmed migration program — scope before file edits.";
    case "capability_setup":
      return "Work plan for your confirmed capability work — define scope before implementation.";
    case "refactor_scope":
      return "Work plan for your confirmed refactor scope — confirm targets before edits.";
    case "structure_scaffold":
      return "Work plan for your confirmed structure work — scaffold plan before paths.";
    default:
      return "Work plan from your confirmed understanding — review before any file changes.";
  }
}

/** True when the spec is a Runtime planning-review run (non-execution). */
export function isPlanningReviewSpec(spec: WorkflowSpec): boolean {
  return (
    spec.planningReviewHeadline !== undefined ||
    spec.workPlan !== undefined ||
    spec.tasks.some(t => t.planningReview === true)
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

function workPlanToTasks(workPlan: WorkPlan): WorkflowSpec["tasks"] {
  return workPlan.tasks.map(task => ({
    input:   `${task.action}: ${task.target} — ${task.outcome}`,
    runtime: "cursor" as const,
    label:   `${capitalize(task.action)} ${task.target}`,
    planningReview: true as const,
  }));
}

/**
 * Build a fresh WorkflowSpec for planning review from confirmed understanding.
 * Caller must pass the result to createWorkflowRun (spec hash locks at creation).
 */
export function buildPlanningReviewSpecFromConfirmed(
  confirmed: ConfirmedUnderstandingV1,
): WorkflowSpec {
  const workPlan = generateWorkPlanFromConfirmed(confirmed);
  const headline = headlineForDeliverableType(workPlan.deliverableType);

  return {
    name:                   rawInputName(confirmed),
    planningReviewHeadline: headline,
    workPlan,
    tasks:                  workPlanToTasks(workPlan),
  };
}

function rawInputName(confirmed: ConfirmedUnderstandingV1): string {
  const rawInput = confirmed.rawInput.trim();
  return rawInput ? deriveNameFromIntent(rawInput) : "Planning review";
}

/** Exposed for certification — generate WorkPlan without full spec. */
export { generateWorkPlanFromConfirmed } from "./work-plan-generator.js";
