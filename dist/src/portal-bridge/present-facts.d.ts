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
/** Provision attribution, or `null` when the value has no derivable provision span. */
export type PresentFactAttribution = {
    readonly mechanism: "provision";
} | null;
/** A structured present fact with its attribution decision. */
export type ExportedPresentFact = {
    readonly field: string;
    readonly value: string;
    readonly attribution: PresentFactAttribution;
};
/**
 * Present facts for an IR operation, each carrying the attribution decision
 * computed against the literal request via the canonical `attributeFact`.
 */
export declare function presentFactsForOperation(op: Operation, rawInput: string): ExportedPresentFact[];
//# sourceMappingURL=present-facts.d.ts.map