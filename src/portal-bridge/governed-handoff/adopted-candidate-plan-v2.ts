/**
 * W-E3 / B.S1 — Adopted Candidate Plan V2 as handoff anchor.
 *
 * Reads the portal-supplied `adopted_candidate_plan` wire field, validates the
 * V2 shape, and converts routable tasks into a summary-only CandidatePlanInput
 * that NEVER enters Fix B / normalizeIntent (CP-6, W-E2 stop).
 *
 * executorClass is preserved on the wire for B.S2 routing — this module does
 * not route (CP-4).
 */

import type { CandidatePlanInput } from "../../governed-decision/stages/understanding.js";

const ROUTABLE = new Set(["human", "document", "repo_change"]);

/**
 * Upper bound for adopted V2 handoff summaries. Mirrors Candidate Plan V2
 * `MAX_PLAN_TASKS` (src/candidate-plan/model-adapter.ts) — not the FS-era
 * Fix B / intake bound of 5.
 */
export const MAX_ADOPTED_V2_HANDOFF_STEPS = 8;

export type AdoptedCandidatePlanTaskV2 = {
  readonly id: string;
  readonly action: string;
  readonly deliverable: string;
  readonly outcome: string;
  readonly executorClass: string;
  readonly verificationCue: string;
  readonly rationale: string;
  readonly derivation: "span" | "derived";
  readonly sourceSpan?: { readonly start: number; readonly end: number };
};

export type AdoptedCandidatePlanV2 = {
  readonly format: "usesteady.candidate-plan.v2";
  readonly workItemId: string;
  readonly memoryPointId: string | null;
  readonly ratifiedTextSha256: string;
  readonly baselinePlanHash: string;
  readonly tasks: readonly AdoptedCandidatePlanTaskV2[];
  readonly isCandidate: true;
  readonly modelRuntime: string | null;
  readonly createdAt: string;
};

function hasConcretePathHint(task: AdoptedCandidatePlanTaskV2): boolean {
  const haystack = `${task.deliverable} ${task.action} ${task.outcome}`;
  if (/(?:^|[\s"'`(])([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/.test(haystack)) {
    return true;
  }
  if (/(?:^|[\s"'`(])([A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/.test(haystack)) {
    return true;
  }
  return false;
}

export function isRoutableAdoptedTask(task: AdoptedCandidatePlanTaskV2): boolean {
  if (!ROUTABLE.has(task.executorClass)) return false;
  if (task.executorClass === "repo_change") return hasConcretePathHint(task);
  return true;
}

function readTask(raw: unknown): AdoptedCandidatePlanTaskV2 | null {
  if (raw === null || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t["id"] !== "string" || t["id"].trim().length === 0) return null;
  if (typeof t["action"] !== "string") return null;
  if (typeof t["deliverable"] !== "string") return null;
  if (typeof t["outcome"] !== "string") return null;
  if (typeof t["executorClass"] !== "string") return null;
  if (typeof t["verificationCue"] !== "string") return null;
  if (typeof t["rationale"] !== "string") return null;
  if (t["derivation"] !== "span" && t["derivation"] !== "derived") return null;
  return {
    id: t["id"].trim(),
    action: t["action"],
    deliverable: t["deliverable"],
    outcome: t["outcome"],
    executorClass: t["executorClass"],
    verificationCue: t["verificationCue"],
    rationale: t["rationale"],
    derivation: t["derivation"],
    ...(typeof t["sourceSpan"] === "object" && t["sourceSpan"] !== null
      ? { sourceSpan: t["sourceSpan"] as { start: number; end: number } }
      : {}),
  };
}

/**
 * Parse `adopted_candidate_plan` from the handoff draft body, or null when
 * absent / malformed (fail closed).
 */
export function readAdoptedCandidatePlanV2(body: unknown): AdoptedCandidatePlanV2 | null {
  if (body === null || typeof body !== "object") return null;
  const raw = (body as { adopted_candidate_plan?: unknown }).adopted_candidate_plan;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const plan = raw as Record<string, unknown>;
  if (plan["format"] !== "usesteady.candidate-plan.v2") return null;
  if (plan["isCandidate"] !== true) return null;
  if (!Array.isArray(plan["tasks"]) || plan["tasks"].length === 0) return null;

  const tasks: AdoptedCandidatePlanTaskV2[] = [];
  for (const item of plan["tasks"]) {
    const task = readTask(item);
    if (task === null) return null;
    tasks.push(task);
  }

  return {
    format: "usesteady.candidate-plan.v2",
    workItemId: typeof plan["workItemId"] === "string" ? plan["workItemId"] : "",
    memoryPointId:
      typeof plan["memoryPointId"] === "string" || plan["memoryPointId"] === null
        ? (plan["memoryPointId"] as string | null)
        : null,
    ratifiedTextSha256:
      typeof plan["ratifiedTextSha256"] === "string" ? plan["ratifiedTextSha256"] : "",
    baselinePlanHash:
      typeof plan["baselinePlanHash"] === "string" ? plan["baselinePlanHash"] : "",
    tasks,
    isCandidate: true,
    modelRuntime:
      typeof plan["modelRuntime"] === "string" || plan["modelRuntime"] === null
        ? (plan["modelRuntime"] as string | null)
        : null,
    createdAt: typeof plan["createdAt"] === "string" ? plan["createdAt"] : "",
  };
}

/**
 * Convert an adopted V2 plan into a summary-only CandidatePlanInput for the
 * understanding port. Only routable tasks are included. Returns null when no
 * routable task exists (fail closed — do not invent FS phrases).
 */
export function summaryOnlyPlanFromAdoptedV2(
  plan: AdoptedCandidatePlanV2,
): CandidatePlanInput | null {
  const routable = plan.tasks.filter(isRoutableAdoptedTask);
  if (routable.length === 0) return null;

  const steps = routable.map((t) => {
    const action = t.action.trim();
    const deliverable = t.deliverable.trim();
    const outcome = t.outcome.trim();
    const cue = t.verificationCue.trim();
    // Append verificationCue so content-pin can read quoted bodies that the
    // model put only in the cue (outcome may use `exact content: body`).
    const after =
      cue.length > 0 && cue !== outcome ? `${outcome} · ${cue}` : outcome;
    // Preserve executorClass in the summary so extract-plan / metadata can
    // surface it without inventing an ExecutableOperation (B.S2 routes later).
    return `[${t.executorClass}] ${action}: ${deliverable} — ${after}`;
  });

  if (steps.length > MAX_ADOPTED_V2_HANDOFF_STEPS) return null;
  return { steps, summaryOnly: true };
}
