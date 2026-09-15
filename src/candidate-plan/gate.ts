/**
 * Candidate plan gate — the ONLY producer of CandidatePlanV2 (CP.S1).
 *
 * Enforces the contract invariants where the adapter cannot:
 *   CP-3 zest anchoring (recomputed hash must match the caller's anchor),
 *   CP-5 fail closed (adapter failure / no adapter => none, never an error
 *        that blocks the deterministic V1 path),
 *   CP-6 no fabricated specifics / no goal echoes,
 *   CP-7 inherited forbidden-class discipline, fail-full reporting.
 *
 * Ids, hashes, timestamps and derivation labels are assigned HERE, never
 * by the adapter and never trusted from input.
 */

import { createHash } from "node:crypto";
import { FORBIDDEN_TEMPLATE_ACTIONS } from "../workflow/work-plan-templates.js";
import type { CandidatePlanAdapter } from "./adapter.js";
import type {
  CandidatePlanEvidenceOutcome,
  CandidatePlanEvidenceSink,
} from "./evidence.js";
import {
  CANDIDATE_EXECUTOR_CLASSES,
  type CandidateExecutorClass,
  type CandidatePlanOutcome,
  type CandidatePlanRequest,
  type CandidatePlanTask,
  type CandidateTaskViolation,
  type RawCandidateTask,
} from "./types.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** CP-6 anti-echo: a deliverable that merely restates the ratified goal is
 *  the template defect this contract exists to fix.
 *
 *  Important: do NOT treat "goal contains deliverable" as an echo. Path-bearing
 *  repo_change tasks correctly put a relative path (a goal substring) in the
 *  deliverable — rejecting those collapses every create-file/create-folder
 *  candidate plan to no_valid_tasks and forces planning-theater V1 steps.
 *  Echo = deliverable equals the goal, or deliverable wraps the whole goal. */
function isGoalEcho(deliverable: string, ratifiedText: string): boolean {
  const d = normalize(deliverable);
  const g = normalize(ratifiedText);
  if (d.length === 0 || g.length === 0) return false;
  if (d === g) return true;
  return d.includes(g);
}

function validateTask(
  raw: RawCandidateTask,
  index: number,
  ratifiedText: string,
): { task?: Omit<CandidatePlanTask, "id">; violations: CandidateTaskViolation[] } {
  const violations: CandidateTaskViolation[] = [];

  const required: readonly (readonly [string, string])[] = [
    ["action", raw.action],
    ["deliverable", raw.deliverable],
    ["outcome", raw.outcome],
    ["verificationCue", raw.verificationCue],
    ["rationale", raw.rationale],
  ];
  for (const [name, value] of required) {
    if (typeof value !== "string" || value.trim() === "") {
      violations.push({ index, reason: "empty_field", detail: name });
    }
  }

  const actionWord = (raw.action ?? "").trim().toLowerCase();
  if (
    (FORBIDDEN_TEMPLATE_ACTIONS as readonly string[]).includes(actionWord)
  ) {
    violations.push({
      index,
      reason: "forbidden_action",
      detail: actionWord,
    });
  }

  if (
    !CANDIDATE_EXECUTOR_CLASSES.includes(
      raw.executorClass as CandidateExecutorClass,
    )
  ) {
    violations.push({
      index,
      reason: "invalid_executor_class",
      detail: String(raw.executorClass),
    });
  }

  if (typeof raw.deliverable === "string" && isGoalEcho(raw.deliverable, ratifiedText)) {
    violations.push({
      index,
      reason: "goal_echo",
      detail: "deliverable restates the ratified goal",
    });
  }

  // PLAN_VS_REALITY_B_STRUCT_V1 — cues/outcomes propose; Evidence verbs are
  // post-execution only. Fail-closed (drop task); never stamp Reality agree.
  const EVIDENCE_VERBS =
    /\b(?:Verified by|Verified against reality|Reality agree|Reality disagree)\b/i;
  for (const [name, value] of [
    ["outcome", raw.outcome],
    ["verificationCue", raw.verificationCue],
  ] as const) {
    if (typeof value === "string" && EVIDENCE_VERBS.test(value)) {
      violations.push({
        index,
        reason: "evidence_verb_in_planning",
        detail: name,
      });
    }
  }

  let span: { start: number; end: number } | undefined;
  if (raw.sourceSpan !== undefined) {
    const { start, end } = raw.sourceSpan;
    const valid =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= ratifiedText.length;
    if (valid) {
      span = { start, end };
    } else {
      violations.push({
        index,
        reason: "invalid_span",
        detail: `start=${String(start)} end=${String(end)} len=${ratifiedText.length}`,
      });
    }
  }

  if (violations.length > 0) return { violations };

  return {
    violations,
    task: {
      action: raw.action.trim(),
      deliverable: raw.deliverable.trim(),
      outcome: raw.outcome.trim(),
      executorClass: raw.executorClass as CandidateExecutorClass,
      verificationCue: raw.verificationCue.trim(),
      rationale: raw.rationale.trim(),
      derivation: span ? "span" : "derived",
      ...(span ? { sourceSpan: span } : {}),
    },
  };
}

/**
 * Generate a candidate plan. Returns `none` (never throws) on any failure
 * mode — the deterministic V1 plan is always the floor (CP-1, CP-5).
 *
 * CP.S4 (CP-8): every generation — including every fail-closed path —
 * emits exactly one content-free evidence line via the optional sink.
 * A throwing sink never blocks generation; no sink = byte-identical.
 */
export async function generateCandidatePlan(
  adapter: CandidatePlanAdapter | null,
  request: CandidatePlanRequest,
  sink?: CandidatePlanEvidenceSink,
): Promise<CandidatePlanOutcome> {
  const emit = (
    outcome: CandidatePlanEvidenceOutcome,
    acceptedTaskCount: number,
    violationCount: number,
  ): void => {
    if (!sink) return;
    try {
      sink({
        kind: "candidate_plan_generation",
        workItemId: request.workItemId,
        ratifiedTextSha256: request.ratifiedTextSha256,
        baselinePlanHash: request.baselinePlanHash,
        modelRuntime: adapter?.runtime ?? null,
        outcome,
        acceptedTaskCount,
        violationCount,
      });
    } catch {
      // Evidence is best-effort (CP-8): never blocks generation.
    }
  };

  if (adapter === null) {
    emit("no_adapter", 0, 0);
    return { kind: "none", reason: "no_adapter", violations: [] };
  }

  // CP-3: the anchor is recomputed here, never trusted from the caller.
  if (sha256(request.ratifiedText) !== request.ratifiedTextSha256) {
    emit("anchor_mismatch", 0, 0);
    return { kind: "none", reason: "anchor_mismatch", violations: [] };
  }

  let raw: readonly RawCandidateTask[];
  try {
    raw = await adapter.draftTasks(request.ratifiedText);
  } catch (err) {
    emit("adapter_failure", 0, 0);
    return {
      kind: "none",
      reason: `adapter_failure: ${err instanceof Error ? err.message : String(err)}`,
      violations: [],
    };
  }

  const accepted: CandidatePlanTask[] = [];
  const violations: CandidateTaskViolation[] = [];
  raw.forEach((rawTask, index) => {
    const result = validateTask(rawTask, index, request.ratifiedText);
    violations.push(...result.violations);
    if (result.task) {
      accepted.push({ id: `cp-${accepted.length + 1}`, ...result.task });
    }
  });

  if (accepted.length === 0) {
    emit("no_valid_tasks", 0, violations.length);
    return { kind: "none", reason: "no_valid_tasks", violations };
  }

  emit("candidate", accepted.length, violations.length);
  return {
    kind: "candidate",
    plan: {
      format: "usesteady.candidate-plan.v2",
      workItemId: request.workItemId,
      memoryPointId: request.memoryPointId,
      ratifiedTextSha256: request.ratifiedTextSha256,
      baselinePlanHash: request.baselinePlanHash,
      tasks: accepted,
      isCandidate: true,
      modelRuntime: adapter.runtime,
      createdAt: new Date().toISOString(),
    },
    violations,
  };
}
