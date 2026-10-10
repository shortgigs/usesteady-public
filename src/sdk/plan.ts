/**
 * UseSteady internal Agent SDK — planProposal (Phase 5, slices 5-pre + 5-1).
 *
 * Stage 1-3 of the pipeline (Proposal -> RoutingSurface -> DecisionBasis), as a
 * thin typed facade over the Phase 4 SSOT `computeArtifactsForSpec`. No forked
 * routing: it runs the SAME shared engine functions both renderers prove. Zero
 * authority — describing/fingerprinting grants nothing.
 */

import {
  computeArtifactsForSpec,
  buildSynthesizedSpecFromNL,
} from "../workflow/cross-surface-parity.js";
import { deriveWorkflowRunId } from "../workflow/index.js";
import type { WorkflowSpec } from "../workflow/types.js";
import {
  SDK_CANONICAL_SPEC_NAME,
  type SdkContext,
  type SdkPlan,
  type SdkProposalInput,
} from "./types.js";

/**
 * Build the canonical spec for a proposal: NL is synthesized into a single-task
 * spec; an authored spec keeps its tasks but is re-named to the canonical name.
 * The canonical name is what makes the SDK's fingerprint/run id match the run
 * the host will execute (see SDK_CANONICAL_SPEC_NAME).
 */
function canonicalSpecFor(input: SdkProposalInput): WorkflowSpec {
  if (input.kind === "nl") {
    return buildSynthesizedSpecFromNL(input.rawInput, SDK_CANONICAL_SPEC_NAME);
  }
  return { ...input.spec, name: SDK_CANONICAL_SPEC_NAME };
}

/**
 * Compute the pre-execution plan for a proposal. Reuses the shared engine core
 * (safety AHEAD of routing; surface undefined on block) and derives the run id
 * the eventual `createWorkflowRun(plan.spec, ...)` will assign.
 */
export async function planProposal(
  input: SdkProposalInput,
  ctx: SdkContext,
): Promise<SdkPlan> {
  const spec = canonicalSpecFor(input);

  // Spec-only basis (repository: null), matching both production surfaces. This
  // keeps the SDK fingerprint == createWorkflowRun(plan.spec) unconditionally.
  const artifacts = await computeArtifactsForSpec({
    spec,
    root: ctx.root,
    suggest: ctx.suggest,
    repository: null,
  });

  return {
    rawInput: input.kind === "nl" ? input.rawInput : (spec.tasks[0]?.input ?? ""),
    specName: SDK_CANONICAL_SPEC_NAME,
    spec,
    safety: artifacts.safety,
    surface: artifacts.surface,
    intentReflection: artifacts.intentReflection,
    decisionBasis: artifacts.decisionBasis,
    decisionBasisFingerprint: artifacts.decisionBasisFingerprint,
    workflowRunId: deriveWorkflowRunId(spec),
  };
}
