/**
 * CandidatePlanAdapter — model seam (CP.S1).
 *
 * Adapters draft raw tasks from the ratified zest and decide nothing:
 * validation, anchoring, hashing and every accept/drop decision happen at
 * the gate. Models are replaceable runtime components — no adapter may be
 * required for UseSteady to function (CP-5 removal invariant).
 */

import type { RawCandidateTask } from "./types.js";

export interface CandidatePlanAdapter {
  /** Human-readable runtime label (metadata only, never authorship). */
  readonly runtime: string;
  /**
   * Draft candidate tasks from the exact ratified goal text. Throwing or
   * returning an empty array are both valid — the gate fails closed to
   * the deterministic V1 plan.
   */
  draftTasks(ratifiedText: string): Promise<readonly RawCandidateTask[]>;
}

/** Deterministic stub for tests and offline use. Emits tasks that satisfy
 *  the validator so the gate path is exercisable without a model. */
export class StubCandidatePlanAdapter implements CandidatePlanAdapter {
  readonly runtime = "stub";

  async draftTasks(
    ratifiedText: string,
  ): Promise<readonly RawCandidateTask[]> {
    const subject = ratifiedText.split(/\s+/).slice(0, 4).join(" ");
    return [
      {
        action: "draft",
        deliverable: `One-page requirements outline covering actors, core flows and constraints`,
        outcome: "Requirements outline exists and names every actor",
        executorClass: "document",
        verificationCue: "The outline document exists and lists actors and flows",
        rationale: `First decomposition step for: ${subject}`,
      },
      {
        action: "define",
        deliverable: `Milestone list with one observable completion criterion per milestone`,
        outcome: "Milestones are individually verifiable",
        executorClass: "document",
        verificationCue: "Each milestone names its completion evidence",
        rationale: "Sequencing before any build step",
      },
    ];
  }
}
