/**
 * USESTEADY_CORE_PRESENT_FACT_EXPORT_V1 -- per-step present-fact export.
 *
 * Extracts the structured present facts from an IR `Operation` and attaches the
 * attribution DECISION computed by the canonical `attributeFact` helper -- the
 * same single decision used by the approval UI (#819, mirrored in
 * `ui/src/helpers/attribution.ts`) and the certification harness
 * (`scripts/cert-presence-mechanism.ts`). The attribution decision happens once,
 * in core; downstream surfaces (portal / Ops) only display transported evidence.
 *
 * Boundary (this lane):
 *   - COMPUTES present facts + attribution. Does NOT render, persist, or change
 *     authority / routing / execution.
 *   - Emits attribution only for the operation shapes the presence-mechanism
 *     certificate covers (create, create_dir, delete, rename, replace). Other
 *     shapes (append, prepend, run) produce no present facts here -- they are
 *     outside the certified attribution set, and we never attribute from prose.
 *   - When a value does not trace to the literal request, `attribution` is
 *     `null` (honest). A downstream renderer shows nothing for a null attribution.
 *
 * Pure: no I/O, no authority.
 */

import type { Operation } from "../input/ir.js";
import { attributeFact } from "../understand/interpretation/attribution.js";

/** Provision attribution, or `null` when the value has no derivable provision span. */
export type PresentFactAttribution = { readonly mechanism: "provision" } | null;

/** A structured present fact with its attribution decision. */
export type ExportedPresentFact = {
  readonly field: string;
  readonly value: string;
  readonly attribution: PresentFactAttribution;
};

/**
 * Structured fact values for the certified operation set. Field names match the
 * approval UI and certification harness (path / from / to / find / replace / file)
 * so the same value is attributed identically across every surface.
 */
function structuredFacts(op: Operation): { field: string; value: string }[] {
  switch (op.type) {
    case "create":
    case "create_dir":
    case "delete":
      return [{ field: "path", value: op.args.path }];
    case "rename":
      return [
        { field: "from", value: op.args.from },
        { field: "to", value: op.args.to },
      ];
    case "replace":
      return [
        { field: "find", value: op.args.from },
        { field: "replace", value: op.args.to },
        { field: "file", value: op.args.file },
      ];
    // append / prepend / run: outside the certified attribution set -- emit
    // nothing rather than attribute against an uncertified shape.
    case "append":
    case "prepend":
    case "run":
      return [];
  }
}

/**
 * Present facts for an IR operation, each carrying the attribution decision
 * computed against the literal request via the canonical `attributeFact`.
 */
export function presentFactsForOperation(
  op: Operation,
  rawInput: string,
): ExportedPresentFact[] {
  return structuredFacts(op).map((f) => ({
    field:       f.field,
    value:       f.value,
    attribution: attributeFact(f.value, rawInput),
  }));
}
