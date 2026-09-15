/**
 * USESTEADY_OPENALEX_OBSERVER_BOUNDARY_VALIDATION_V1 — source-agnostic observer.
 *
 * `observeEvidence` is the ONLY intended integration point and it is NOT wired
 * into any gate. It takes an EvidenceSource (OpenAlex is the first implementation,
 * not the schema), discovers references, and records them to the opt-in sink.
 *
 * Zero authority. Best-effort: any failure (network, budget, parse) returns null,
 * so an unavailable observer never blocks or alters a decision. This module
 * imports NO Constitution surface — it cannot touch the Decision Basis or the
 * fingerprint.
 */

import type { EvidenceObservation, EvidenceSource } from "./types.js";
import { recordEvidenceObservation } from "./observer-sink.js";

/**
 * Discover references for a run via any EvidenceSource and record them to the
 * opt-in sink. Returns the observation, or `null` on any failure.
 *
 * A reviewer tool may call this; the decision path never does. Failures are
 * swallowed — the observer never affects a decision.
 */
export async function observeEvidence(args: {
  readonly workflowRunId: string;
  readonly query: string;
  readonly source: EvidenceSource;
  readonly maxResults?: number;
}): Promise<EvidenceObservation | null> {
  try {
    const references = await args.source.search(args.query, args.maxResults);
    const observation: EvidenceObservation = {
      workflowRunId: args.workflowRunId,
      query: args.query,
      capturedAt: new Date().toISOString(),
      references,
    };
    recordEvidenceObservation(observation);
    return observation;
  } catch {
    return null;
  }
}
