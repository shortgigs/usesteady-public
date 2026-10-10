/**
 * Deterministic workflow_generation adapter for portal D2 (no LLM).
 * Decomposes broad multi-step intents into reviewable draft steps.
 * Zero authority — suggestions only; portal presents, does not execute.
 */

import type { Skill, SkillOutput, WorkflowDraftOutput, WorkflowStep } from "./types.js";
import type { SkillModelAdapter } from "./invocation.js";

const MULTI_STEP_SIGNAL_RE =
  /\b(workflow|workflows|multi[- ]?step|scaffold|bootstrap|set up|setup|review|summar(?:y|ize|ise)|feedback|process|pipeline)\b/i;

const COMPOUND_CONNECTOR_RE = /\s+(?:and|then|also|&)\s+/i;

function looksLikeBroadWorkflowIntent(rawInput: string): boolean {
  const trimmed = rawInput.trim();
  if (trimmed.length < 12) return false;
  return MULTI_STEP_SIGNAL_RE.test(trimmed) || COMPOUND_CONNECTOR_RE.test(trimmed);
}

function deriveWorkflowName(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (trimmed.length <= 48) return trimmed;
  const cut = trimmed.slice(0, 45).trim();
  return `${cut}…`;
}

function buildStepsFromIntent(rawInput: string): readonly WorkflowStep[] {
  const lower = rawInput.toLowerCase();

  if (
    (lower.includes("feedback") || lower.includes("review")) &&
    (lower.includes("summary") || lower.includes("summar"))
  ) {
    return [
      {
        input: "create folder customer-feedback",
        reason: "Collect customer feedback in one place before you review it",
      },
      {
        input: 'create file feedback-review.md with "# Feedback review"',
        reason: "Review and organize feedback into a structured note",
      },
      {
        input: 'create file feedback-summary.md with "# Summary"',
        reason: "Produce a summary document from the reviewed feedback",
      },
    ];
  }

  if (lower.includes("scaffold") || lower.includes("set up") || lower.includes("setup")) {
    return [
      {
        input: "create folder src",
        reason: "Create the top-level project structure",
      },
      {
        input: "create file README.md",
        reason: "Add a README that describes the scaffolded layout",
      },
      {
        input: "create file src/index.ts",
        reason: "Add an entry point file for the new module",
      },
    ];
  }

  const segments = rawInput
    .split(COMPOUND_CONNECTOR_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  if (segments.length >= 2) {
    return segments.slice(0, 4).map((segment, i) => ({
      input: segment.length > 80 ? `${segment.slice(0, 77)}…` : segment,
      reason: `Step ${i + 1}: ${segment}`,
    }));
  }

  return [
    {
      input: rawInput.trim(),
      reason: "Clarify the goal and scope of this workflow",
    },
    {
      input: 'create file plan.md with "# Plan"',
      reason: "Capture the planned steps in a reviewable document",
    },
    {
      input: 'create file outcome.md with "# Outcome"',
      reason: "Record the expected outcome before any execution",
    },
  ];
}

export class LocalWorkflowDraftAdapter implements SkillModelAdapter {
  async invoke(skill: Skill, rawInput: string): Promise<SkillOutput | null> {
    if (skill.metadata.output_schema !== "usesteady.workflow_draft.v1") {
      return null;
    }

    if (!looksLikeBroadWorkflowIntent(rawInput)) {
      return null;
    }

    const steps = buildStepsFromIntent(rawInput);
    if (steps.length === 0) {
      return null;
    }

    const output: WorkflowDraftOutput = {
      schema: "usesteady.workflow_draft.v1",
      skill: { name: skill.metadata.name, version: skill.metadata.version },
      name: deriveWorkflowName(rawInput),
      steps,
    };

    return output;
  }
}
