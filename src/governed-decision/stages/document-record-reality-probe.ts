/**
 * W-E6 / B.S4 — Independent reality probe for document-record execution.
 *
 * Verifies the execution record itself: every approved document_record op
 * must appear as `ran` with a detail that includes the statement. This is
 * independent of the Router delivery self-report (INV-WL-1 posture).
 */

import type { ExecutionPayload } from "../types.js";
import type { RealityProbe, RealityProbeResult } from "./observation.js";

export function makeDocumentRecordRealityProbe(): RealityProbe {
  return (execution: ExecutionPayload): RealityProbeResult => {
    const results = execution.results ?? [];
    if (results.length === 0) {
      return { realityVerdict: "disagree", detail: "no execution results to verify" };
    }

    for (const r of results) {
      if (r.op.kind !== "document_record") {
        return {
          realityVerdict: "disagree",
          detail: `unexpected op kind in document-record run: ${r.op.kind}`,
        };
      }
      if (r.status !== "ran") {
        return {
          realityVerdict: "disagree",
          detail: `document_record did not run: ${r.detail ?? r.status}`,
        };
      }
      const statement = r.op.statement;
      if (!r.detail.includes(statement)) {
        return {
          realityVerdict: "disagree",
          detail: "execution detail missing approved document statement",
        };
      }
    }

    if (!execution.ranWhatWasApproved) {
      return {
        realityVerdict: "disagree",
        detail: "ranWhatWasApproved is false",
      };
    }

    return {
      realityVerdict: "agree",
      detail: `verified ${results.length} document_record result(s)`,
    };
  };
}
