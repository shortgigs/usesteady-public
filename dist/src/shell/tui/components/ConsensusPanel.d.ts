/**
 * TUI v2 — ConsensusPanel component.
 *
 * Appears ONLY when ALL conditions are true:
 *   1. status === "Blocked"
 *   2. consensus array is present and non-empty
 *   3. Multi-LLM was active for this task (implied by consensus being set)
 *
 * Hidden entirely otherwise — no placeholder, no empty rows.
 *
 * Exact scope (v2 — intentionally minimal):
 *   Claude:     Accepted
 *   Secondary:  Execution error
 *
 * What is NOT shown here (deferred to v2.1+):
 *   · Round counts
 *   · Normalized hashes
 *   · Rationale codes or internal enums
 *   · Per-round breakdown across multiple rounds
 */
import type { TuiConsensusEntry } from "../types.js";
type Props = {
    readonly entries: readonly TuiConsensusEntry[] | undefined;
};
export declare function ConsensusPanel({ entries }: Props): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=ConsensusPanel.d.ts.map