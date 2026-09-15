/**
 * Sprint D2 — Portal Understand Bridge (core).
 * raw NL → normalizeNLToIR → preview steps (read-only).
 * No WorkflowRun, no filesystem, no execution.
 */

import { normalizeNLToIR } from "../input/nl-to-ir.js";
import type { Operation } from "../input/ir.js";
import { runIntake } from "../intake/intake-service.js";
import { runSafetyGate } from "../safety/safety-gate.js";
import type { IntakeContext } from "../intake/types.js";
import { DEFAULT_CONTRACT } from "../interaction/defaults.js";
import { formatIntakeResult } from "../present/format.js";
import { mapIROpToStructuredFields } from "../shell/cli/ir-to-spec-fields.js";
import { invokeSkillsForTrigger } from "../skills/invocation.js";
import type { SkillModelAdapter } from "../skills/invocation.js";
import {
  shouldConsultSkills,
  getSkillsByKind,
} from "../skills/registry.js";
import type { LoadedSkillRegistry, WorkflowDraftOutput } from "../skills/types.js";
import type { ContextEnvelopeV1 } from "./context-envelope-v1.js";
import type {
  PortalUnderstandStep,
  PortalUnderstandWorkflowResult,
  PortalUnderstandSource,
} from "./types.js";
import { presentFactsForOperation } from "./present-facts.js";

import { ensureUcpIntentRoot } from "../ucp/ensure-intent-root.js";
import { DEFAULT_STORE_DIR } from "../shell/defaults.js";
import {
  buildReviewDraftFromConfirmedUnderstanding,
  type ConfirmedUnderstandingV1,
} from "./confirmed-understanding-handoff.js";

const PORTAL_INTAKE_CONTEXT: IntakeContext = {
  prvContext: { hasPriorSession: false },
  interactionContract: DEFAULT_CONTRACT,
};

function operationTitle(op: Operation): string {
  switch (op.type) {
    case "create_dir":
      return "Create folder";
    case "create":
      return "Create file";
    case "delete":
      return "Delete";
    case "rename":
      return "Rename";
    case "replace":
      return "Replace text";
    case "append":
      return "Append text";
    case "prepend":
      return "Prepend text";
    case "run":
      return "Run command";
    default:
      return "Workflow step";
  }
}

function operationSummary(op: Operation): string {
  switch (op.type) {
    case "create_dir":
      return `Create directory at ${op.args.path}`;
    case "create":
      return op.args.contents
        ? `Create file ${op.args.path} with content`
        : `Create file ${op.args.path}`;
    case "delete":
      return `Delete ${op.args.path}`;
    case "rename":
      return `Rename ${op.args.from} to ${op.args.to}`;
    case "replace":
      return `Replace text in ${op.args.file}`;
    case "append":
      return `Append to ${op.args.file}`;
    case "prepend":
      return `Prepend to ${op.args.file}`;
    case "run":
      return `Run command: ${op.args.command}`;
    default:
      return "Review this step before anything runs";
  }
}

function operationInputPhrase(op: Operation): string {
  switch (op.type) {
    case "create_dir":
      return `mkdir ${op.args.path}`;
    case "create":
      return `create file ${op.args.path}`;
    case "delete":
      return `delete file ${op.args.path}`;
    case "rename":
      return `rename ${op.args.from} to ${op.args.to}`;
    case "replace":
      return `replace "${op.args.from}" with "${op.args.to}" in ${op.args.file}`;
    case "append":
      return `append "${op.args.text}" to ${op.args.file}`;
    case "prepend":
      return `prepend "${op.args.text}" to ${op.args.file}`;
    case "run":
      return `run ${op.args.command}`;
    default:
      return "";
  }
}

function stepFromOperation(op: Operation, rawIntent: string): PortalUnderstandStep {
  // USESTEADY_CORE_PRESENT_FACT_EXPORT_V1: the IR-operation path is the only
  // step builder with structured facts. Attribution is computed once here via
  // the canonical helper. Prose builders (bullets, intake labels, draft reasons)
  // intentionally emit no present_facts -- core never attributes from prose.
  const presentFacts = presentFactsForOperation(op, rawIntent);
  return {
    index: 0,
    title: operationTitle(op),
    summary: operationSummary(op),
    input: operationInputPhrase(op) || rawIntent.trim(),
    ...(presentFacts.length > 0 ? { present_facts: presentFacts } : {}),
  };
}

function stepsFromWorkflowDraft(
  draft: WorkflowDraftOutput,
): readonly PortalUnderstandStep[] {
  return draft.steps.map((step, index) => ({
    index,
    title:
      step.reason.length > 56
        ? `${step.reason.slice(0, 53)}…`
        : step.reason,
    summary: step.reason,
    input: step.input,
  }));
}

function stepsFromPresentation(
  labels: readonly string[],
  headline: string,
): readonly PortalUnderstandStep[] {
  if (labels.length === 0) {
    return [
      {
        index: 0,
        title: "Review your request",
        summary: headline,
      },
    ];
  }

  return labels.map((label, index) => ({
    index,
    title: label.length > 56 ? `${label.slice(0, 53)}…` : label,
    summary: label,
  }));
}

function success(
  source: PortalUnderstandSource,
  name: string,
  headline: string,
  steps: readonly PortalUnderstandStep[],
  context: ContextEnvelopeV1,
  presentation?: { mode: string; certaintyLevel?: string },
  ucpLinkage?: { ucpRootId: string; ucpBundleHash?: string },
): PortalUnderstandWorkflowResult {
  if (steps.length === 0) {
    return {
      ok: false,
      message: "Could not produce reviewable steps for this request.",
      code: "no_steps",
    };
  }

  const linkage = ucpLinkage ?? { ucpRootId: `ucp_fallback_${Date.now().toString(36)}` }; // extreme fallback only

  return {
    ok: true,
    source,
    name,
    headline,
    steps,
    context,
    ...(presentation ? { presentation } : {}),
    ucp_root_id: linkage.ucpRootId,
    ...(linkage.ucpBundleHash ? { ucp_bundle_hash: linkage.ucpBundleHash } : {}),
  };
}

async function tryWorkflowGeneration(
  intent: string,
  registry: LoadedSkillRegistry,
  adapter: SkillModelAdapter,
  context: ContextEnvelopeV1,
): Promise<PortalUnderstandWorkflowResult | null> {
  const trigger = { kind: "workflow_generation" as const, rawInput: intent };

  if (!shouldConsultSkills(registry, trigger)) {
    return null;
  }

  const result = await invokeSkillsForTrigger({
    registry,
    triggerReason: trigger,
    rawInput: intent,
    adapter,
  });

  const draft = result.accepted.find(
    (o): o is WorkflowDraftOutput => o.schema === "usesteady.workflow_draft.v1",
  );

  if (!draft || draft.steps.length === 0) {
    return null;
  }

  const linkage = captureUcpProvenance(intent);
  return success(
    "workflow_generation",
    draft.name || deriveNameFromIntent(intent),
    "We broke your request into reviewable steps.",
    stepsFromWorkflowDraft(draft),
    context,
    { mode: "guide", certaintyLevel: "inferred" },
    linkage,
  );
}

function tryIntakePresent(
  intent: string,
  context: ContextEnvelopeV1,
): PortalUnderstandWorkflowResult | null {
  const intake = runIntake(intent, PORTAL_INTAKE_CONTEXT);
  const present = formatIntakeResult(intake);

  if (intake.mode === "refuse" || intake.mode === "ignore") {
    return {
      ok: false,
      message: present.headline,
      code: intake.mode,
    };
  }

  const labels = present.steps ?? [];
  if (labels.length === 0 && intake.mode !== "execute") {
    return null;
  }

  const steps =
    intake.mode === "execute" && intake.interpretation
      ? [
          {
            index: 0,
            title: present.category ?? "Planned change",
            summary: intake.interpretation.summary,
            input: intent,
          },
        ]
      : stepsFromPresentation(labels, present.headline);

  const linkage = captureUcpProvenance(intent);
  return success(
    "intake",
    deriveNameFromIntent(intent),
    present.headline,
    steps,
    context,
    {
      mode: present.mode,
      certaintyLevel: present.certaintyLevel,
    },
    linkage,
  );
}

function deriveNameFromIntent(intent: string): string {
  const trimmed = intent.trim();
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45).trim()}…`;
}

function captureUcpProvenance(intent: string): { ucpRootId: string; ucpBundleHash?: string } {
  const { ucpRootId } = ensureUcpIntentRoot(DEFAULT_STORE_DIR, intent);
  return { ucpRootId };
}

export type UnderstandWorkflowIntentDeps = {
  readonly registry: LoadedSkillRegistry;
  readonly workflowDraftAdapter: SkillModelAdapter;
  /** Sprint 8 — certified workspace binding (required for portal). */
  readonly context: ContextEnvelopeV1;
  /** Intent → decomposition handoff v1 — post-confirm planning steps. */
  readonly confirmedUnderstanding?: ConfirmedUnderstandingV1 | null;
};

/**
 * Understand portal workflow intent — read-only pipeline for D2 + ContextEnvelope.
 */
export async function understandWorkflowIntent(
  intent: string,
  deps: UnderstandWorkflowIntentDeps,
): Promise<PortalUnderstandWorkflowResult> {
  const trimmed = intent.trim();
  if (!trimmed) {
    return { ok: false, message: "Intent is required.", code: "empty_intent" };
  }

  // USESTEADY_PREVIEW_SAFETY_WIRING_IMPL_V1 (#847): the common preview entry. The
  // existing safety gate runs here, BEFORE the confirmed / IR / skills / intake
  // branches, so every preview path honors a `block`. Per #846 (verdict A): a
  // blocked action must never have a contradictory preview surface -- no WorkPlan,
  // IR, or clarify draft is rendered for a blocked intent; the safety response is
  // returned instead. This is a placement of the existing gate only: no detector,
  // policy, extractor, approval, or authority change. The extractor still admits
  // hostile imperatives as goals downstream (orthogonality, #837); this surface
  // simply does not present a blocked intent as an actionable plan. Intake keeps
  // its own gate as defense-in-depth (and for non-portal callers).
  const safety = runSafetyGate(trimmed);
  if (safety.verdict === "block") {
    const detail = {
      ...(safety.reason ? { reason: safety.reason } : {}),
      ...(safety.detectorId ? { detectorId: safety.detectorId } : {}),
      ...(safety.matchedPattern ? { matchedPattern: safety.matchedPattern } : {}),
    };
    return {
      ok: false,
      code: "blocked_by_safety",
      message:
        safety.note ?? "This request was blocked by a safety policy and cannot be planned.",
      ...(Object.keys(detail).length > 0 ? { safety: detail } : {}),
    };
  }

  if (deps.confirmedUnderstanding) {
    const fromConfirmed = buildReviewDraftFromConfirmedUnderstanding(
      trimmed,
      deps.confirmedUnderstanding,
      deps.context,
    );
    if (fromConfirmed.ok) {
      return fromConfirmed;
    }
    if (fromConfirmed.code !== "empty_intent") {
      return fromConfirmed;
    }
  }

  const parsed = normalizeNLToIR(trimmed, "stdin");

  if (parsed.kind === "ok") {
    const op = parsed.ir.operations[0];
    if (op) {
      const mapped = mapIROpToStructuredFields(op);
      const headline = mapped.ok
        ? `Understood as a ${operationTitle(op).toLowerCase()} operation.`
        : mapped.reason;

      const linkage = captureUcpProvenance(trimmed);
      return success(
        "ir",
        deriveNameFromIntent(trimmed),
        headline,
        [stepFromOperation(op, trimmed)],
        deps.context,
        { mode: "execute", certaintyLevel: "certain" },
        linkage,
      );
    }
  }

  const fromSkills = await tryWorkflowGeneration(
    trimmed,
    deps.registry,
    deps.workflowDraftAdapter,
    deps.context,
  );
  if (fromSkills?.ok) {
    return fromSkills;
  }

  const fromIntake = tryIntakePresent(trimmed, deps.context);
  if (fromIntake) {
    return fromIntake;
  }

  if (fromSkills && !fromSkills.ok) {
    return fromSkills;
  }

  return {
    ok: false,
    message:
      "We could not turn this into reviewable steps. Try naming specific files or actions.",
    code: "understand_failed",
  };
}

/** True when registry has workflow_generation skills loaded. */
export function hasWorkflowGenerationSkills(
  registry: LoadedSkillRegistry,
): boolean {
  return getSkillsByKind(registry, "workflow_generation").length > 0;
}
