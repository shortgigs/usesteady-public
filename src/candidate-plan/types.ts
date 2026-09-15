/**
 * USESTEADY_CANDIDATE_PLAN_CONTRACT_V2 — canonical types (CP.S1).
 *
 * The Governance Layer's model-collaborative plan: candidates, never truth.
 * The deterministic V1 WorkPlan (USESTEADY_WORKPLAN_GENERATION_V1) is the
 * floor and is never replaced (CP-1). Every hash and timestamp is assigned
 * by the gate (gate.ts), never by an adapter and never trusted from input.
 */

/** Proposed executor class — a PROPOSAL, never a routing decision (CP-4). */
export type CandidateExecutorClass =
  | "repo_change"
  | "document"
  | "cli"
  | "human"
  | "external";

export const CANDIDATE_EXECUTOR_CLASSES: readonly CandidateExecutorClass[] = [
  "repo_change",
  "document",
  "cli",
  "human",
  "external",
];

export type CandidatePlanTask = {
  readonly id: string;
  /** Verb — checked against the inherited forbidden classes (CP-7). */
  readonly action: string;
  /** Concrete named artifact — never a restatement of the goal (CP-6). */
  readonly deliverable: string;
  /** Observable completion statement. */
  readonly outcome: string;
  readonly executorClass: CandidateExecutorClass;
  /** What evidence could later confirm this task really happened. */
  readonly verificationCue: string;
  /** Why this task, from the zest. */
  readonly rationale: string;
  /** span = anchored to the ratified text; derived = honest inference. */
  readonly derivation: "span" | "derived";
  readonly sourceSpan?: { readonly start: number; readonly end: number };
};

export type CandidatePlanV2 = {
  readonly format: "usesteady.candidate-plan.v2";
  readonly workItemId: string;
  /** Anchor to the ratified memory point when the memory layer holds one. */
  readonly memoryPointId: string | null;
  /** SHA-256 of the exact ratified goal text this plan decomposes (CP-3). */
  readonly ratifiedTextSha256: string;
  /** planHash of the deterministic V1 plan this enriches — the floor. */
  readonly baselinePlanHash: string;
  readonly tasks: readonly CandidatePlanTask[];
  /** Literal true (CP-2): a candidate plan can never assert authority. */
  readonly isCandidate: true;
  /** Runtime metadata only — never authorship provenance. */
  readonly modelRuntime: string | null;
  readonly createdAt: string;
};

/** Raw adapter output before the gate validates it. Untrusted. */
export type RawCandidateTask = {
  readonly action: string;
  readonly deliverable: string;
  readonly outcome: string;
  readonly executorClass: string;
  readonly verificationCue: string;
  readonly rationale: string;
  readonly sourceSpan?: { readonly start: number; readonly end: number };
};

export type CandidatePlanRequest = {
  readonly workItemId: string;
  /** The exact ratified visible goal text (the zest). */
  readonly ratifiedText: string;
  /** Anchor the caller believes it holds; gate recomputes and compares. */
  readonly ratifiedTextSha256: string;
  readonly memoryPointId: string | null;
  /** planHash of the deterministic V1 plan (the floor, CP-1). */
  readonly baselinePlanHash: string;
};

/** One dropped-task report line (fail-full, CP-7). */
export type CandidateTaskViolation = {
  readonly index: number;
  readonly reason:
    | "forbidden_action"
    | "goal_echo"
    | "invalid_span"
    | "invalid_executor_class"
    | "empty_field"
    /** PLAN_VS_REALITY_B_STRUCT_V1 — planning must not stamp Evidence verbs. */
    | "evidence_verb_in_planning";
  readonly detail: string;
};

export type CandidatePlanOutcome =
  | {
      readonly kind: "candidate";
      readonly plan: CandidatePlanV2;
      /** All dropped tasks, reported together — never silently (CP-7). */
      readonly violations: readonly CandidateTaskViolation[];
    }
  | {
      /** Fail-closed: the deterministic V1 plan alone (CP-5). */
      readonly kind: "none";
      readonly reason: string;
      readonly violations: readonly CandidateTaskViolation[];
    };
