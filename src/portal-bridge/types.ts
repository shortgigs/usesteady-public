/**
 * Portal Understand Bridge (D2) — read-only types.
 * No execution, no WorkflowRun, no filesystem.
 */

import type { ContextEnvelopeV1 } from "./context-envelope-v1.js";
import type { WorkPlan } from "../workflow/work-plan-types.js";
import type { ClarifyCommitment } from "../workflow/clarify-surface.js";
import type { ExportedPresentFact } from "./present-facts.js";

export type PortalUnderstandSource = "ir" | "workflow_generation" | "intake" | "workplan" | "clarify";

export type PortalUnderstandStep = {
  readonly index: number;
  readonly title: string;
  readonly summary: string;
  /** Task-shaped input when available (for downstream spec synthesis). */
  readonly input?: string;
  /**
   * USESTEADY_CORE_PRESENT_FACT_EXPORT_V1: structured present facts with the
   * attribution decision computed once in core (`attributeFact`). Present only
   * for IR-operation steps on the certified attribution set; ABSENT for prose
   * planning steps (bullets, intake labels, workflow-draft reasons) -- core
   * never attributes from prose. Display-only downstream; a renderer shows
   * nothing for an absent list or a `null` attribution.
   */
  readonly present_facts?: readonly ExportedPresentFact[];
};

export type PortalUnderstandWorkflowSuccess = {
  readonly ok: true;
  readonly source: PortalUnderstandSource;
  readonly name: string;
  readonly headline: string;
  readonly steps: readonly PortalUnderstandStep[];
  readonly context: ContextEnvelopeV1;
  readonly presentation?: {
    readonly mode: string;
    readonly certaintyLevel?: string;
  };
  /** P0-1 (USESTEADY_P0_MINIMUM_VIABLE_SCOPE_V1): Stable root of the authoritative UCP record for this understood workflow. */
  readonly ucp_root_id: string;
  /** P0-1: Content-addressed hash of the UCPBundle at the moment the workflow was understood. Enables later integrity verification. */
  readonly ucp_bundle_hash?: string;
  /**
   * USESTEADY_PLANNING_SURFACE_AUTHORITY_V1: certified WorkPlan when source is "workplan".
   * Absent for "ir" and "intake" sources. Portal should render workPlan.* when present.
   */
  readonly workPlan?: WorkPlan;
  /**
   * USESTEADY_CLARIFY_SURFACE_IMPL_V1 (ratified S1): four-element Clarify commitment
   * when source is "clarify". Never co-present with workPlan.
   */
  readonly clarify?: ClarifyCommitment;
};

export type PortalUnderstandWorkflowFailure = {
  readonly ok: false;
  readonly message: string;
  readonly code?: string;
  /**
   * USESTEADY_PREVIEW_SAFETY_WIRING_IMPL_V1 (#847): present only when
   * `code === "blocked_by_safety"`. The existing safety gate's inspectable verdict
   * (src/safety/runSafetyGate), surfaced so the portal renders a safety response
   * instead of a draft. Display-only transport -- authority remains src/safety/
   * (the constraint axis, #837). A blocked intent must never carry a WorkPlan/IR/
   * clarify preview: a block is terminal on this surface.
   */
  readonly safety?: {
    readonly reason?: string;
    readonly detectorId?: string;
    readonly matchedPattern?: string;
  };
};

export type PortalUnderstandWorkflowResult =
  | PortalUnderstandWorkflowSuccess
  | PortalUnderstandWorkflowFailure;
