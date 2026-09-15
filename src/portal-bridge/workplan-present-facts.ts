/**
 * USESTEADY_CORE_WORKPLAN_PRESENT_FACT_EXPORT_V1 -- WorkPlan present-fact export.
 *
 * Exports present_facts for a WorkPlan step using ONLY the task's `sourceSpan`
 * over the user's raw request. The attributed value is the literal substring of
 * the request named by the span; the attribution DECISION is computed by the
 * canonical `attributeFact` helper (`src/understand/interpretation/attribution.ts`)
 * -- the same single decision used by the IR export (#820), the approval UI
 * (#819), and the certification harness. The decision happens once, in core.
 *
 * Honesty boundary (this lane):
 *   - Uses `sourceSpan` ONLY. NEVER infers from task `title`, `summary`, `target`
 *     prose, or the plan `goal`.
 *   - Attributes ONLY spans that reference the raw request (`ref === "rawInput"`).
 *     A span over a derived bullet (`bullet:N`) is the system's reflection, not
 *     the user's request, so it cannot satisfy "appears in your request" and
 *     yields no present_fact.
 *   - Span offsets are resolved against the TRIMMED raw input, matching the
 *     WorkPlan isolator (`isolateIntentFromConfirmed`, which indexes
 *     `confirmed.rawInput.trim()`).
 *   - When the span is missing, out of range, empty, or the resolved value does
 *     not trace to the request, NO present_fact is emitted (honest absence).
 *   - COMPUTES only. Does NOT render, persist, or change authority / routing /
 *     execution. No Ops rendering, no StepCard decision, no Capture-B, no
 *     Presence Record -- those are out of scope for this lane.
 *
 * Pure: no I/O, no authority.
 */

import type { WorkPlanTask } from "../workflow/work-plan-types.js";
import { attributeFact } from "../understand/interpretation/attribution.js";
import type { ExportedPresentFact } from "./present-facts.js";

/**
 * Present facts for a single WorkPlan task, derived solely from its `sourceSpan`
 * over the raw request. Returns an empty array when no honest fact can be sourced.
 */
export function presentFactsForWorkPlanTask(
  task: WorkPlanTask,
  rawInput: string,
): ExportedPresentFact[] {
  const span = task.sourceSpan;
  if (!span || span.ref !== "rawInput") return [];

  // Match the isolator's index base: offsets are over the trimmed raw input.
  const base = rawInput.trim();
  const { start, end } = span;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > base.length ||
    start >= end
  ) {
    return [];
  }

  const value = base.slice(start, end).trim();
  if (value.length === 0) return [];

  // Re-validate against the literal request via the canonical decision. A span
  // that does not trace to the request yields null -> no present_fact.
  const attribution = attributeFact(value, rawInput);
  if (attribution === null) return [];

  return [{ field: "target", value, attribution }];
}
