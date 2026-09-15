/**
 * Deterministic HUL templates for blocked-explain (INV-BER-7 / INV-AI-3).
 * Always available when the model is missing, errors, or violates schema.
 */

import {
  BLOCKED_EXPLAIN_FORMAT,
  type BlockedExplainOption,
  type BlockedExplainPayload,
  type BlockedExplainReasonKey,
  type BlockedExplainRefuseCode,
} from "./types.js";

type StaticTemplate = {
  readonly reasonKey: BlockedExplainReasonKey;
  readonly reasonHul: string;
  readonly options: readonly BlockedExplainOption[];
};

/**
 * Aligns with Ops #622 / Core #1037 external-only honesty + planning-skip copy.
 */
const TEMPLATES: Record<BlockedExplainRefuseCode, StaticTemplate> = {
  candidate_plan_external_only: {
    reasonKey: "external_only_plan",
    reasonHul:
      "UseSteady cannot run these approved steps yet — they need an outside system (for example a Shopify store, products, or payments). UseSteady does not operate those systems. Export this approved plan for your own checklist, or start a new work item whose suggested tasks are files, folders, written artifacts, or steps a person can attest inside UseSteady.",
    options: [
      "export_approved_plan",
      "change_the_plan",
      "start_new_work_item",
      "abandon",
    ],
  },
  candidate_plan_not_executable: {
    reasonKey: "not_routable_plan",
    reasonHul:
      "These suggested tasks are not Core-executable yet (missing routable filesystem or code steps). Change the plan to name concrete paths UseSteady can run, or start a new work item, approve each step, then Start execution.",
    options: ["change_the_plan", "start_new_work_item", "abandon"],
  },
  candidate_plan_over_cap: {
    reasonKey: "over_cap_plan",
    reasonHul:
      "This adopted plan has too many executable tasks for one handoff. Split the work, change the plan to a shorter set, or start a new work item with fewer steps.",
    options: ["change_the_plan", "start_new_work_item", "abandon"],
  },
  handoff_not_executable: {
    reasonKey: "handoff_not_derivable",
    reasonHul:
      "This work item's plan has no Core-executable steps. The model must propose executable intent (filesystem or code) for UseSteady to run after you approve — change the plan to adopt those suggested tasks, or rephrase the goal to name concrete deliverables.",
    options: ["change_the_plan", "start_new_work_item", "abandon"],
  },
  approved_plan_hash_mismatch: {
    reasonKey: "approved_hash_stale",
    reasonHul:
      "The approved plan no longer matches what Start is trying to run (hash mismatch). Approve the current plan again before Start — a prior approval seal is not authority for a different plan body.",
    options: ["change_the_plan", "retry_handoff", "abandon"],
  },
  content_pin_failed: {
    reasonKey: "content_pin_refuse",
    reasonHul:
      "UseSteady could not pin the approved step content for execution. Nothing was silently omitted. Fix or change the plan so every approved step has pinable content, then try Start again.",
    options: ["change_the_plan", "retry_handoff", "abandon"],
  },
};

export function staticBlockedExplain(
  refuseCode: BlockedExplainRefuseCode,
): BlockedExplainPayload {
  const t = TEMPLATES[refuseCode];
  return {
    format: BLOCKED_EXPLAIN_FORMAT,
    isCandidate: true,
    refuseCode,
    reasonKey: t.reasonKey,
    reasonHul: t.reasonHul,
    options: t.options,
    modelRuntime: null,
    fromStaticTemplate: true,
  };
}
