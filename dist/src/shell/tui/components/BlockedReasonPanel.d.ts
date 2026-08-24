/**
 * TUI v1.1 — BlockedReasonPanel component.
 *
 * Appears ONLY when status === "Blocked" and blockedReason is set.
 * Hidden entirely otherwise — no placeholder, no empty box.
 *
 * Scope (intentionally minimal):
 *   ❌ Blocked
 *   Reason: <short human-readable text>
 *
 * What is NOT shown here (deferred to ConsensusPanel v2):
 *   · Model-by-model breakdown
 *   · Audit-level details
 *   · Round counts or hashes
 */
type Props = {
    readonly reason: string | undefined;
};
export declare function BlockedReasonPanel({ reason }: Props): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=BlockedReasonPanel.d.ts.map