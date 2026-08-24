/**
 * Pending Approval Bridge — shared remote-decision resolver.
 *
 * Lifted from the CLI confirm-gate hook so CLI and web `POST /confirm` share one
 * path. Authority unchanged: Portal decision is an INPUT to Core's existing
 * `advanceWorkflowOnConfirm` gate; `approved` is necessary, not sufficient
 * (`requiresLocalRevalidation` / INV-LA-ENF1). Fail-closed outcomes return null
 * so the caller falls back to its local decision source (CLI prompt or HTTP body).
 */
import type { WorkflowRun } from "../../workflow/types.js";
import { type DecisionOriginAuthorityAssertionV2, type RetirementAuthorityAssertionV3 } from "../authority-assertion/index.js";
import type { UCPEnvelope } from "../../ucp/types.js";
import { type MappedStorePolicy } from "../../shell/defaults.js";
import { type BridgeOptions } from "./bridge.js";
import type { ApprovalDecisionEntry } from "./decision.js";
import type { PendingApprovalInput } from "./payload.js";
import { type PortalApprovalsConfig } from "./opt-in.js";
/**
 * P1 authority evidence attached to a consumed remote decision.
 *   portal_signed_verified — signature verified against Core's PINNED Portal
 *                            authority key and every binding field matched the
 *                            live gate. decided_by/decided_at may be treated as
 *                            authenticated provenance.
 *   self_asserted          — pinning not configured; the carried identity/time
 *                            are Portal-transport metadata, not verified proof.
 *   verification_failed    — pinning configured but the assertion was absent or
 *                            failed verification (fail-closed; see below).
 */
export type RemoteAuthorityEvidence = {
    readonly status: "portal_signed_verified";
    readonly assertion: DecisionOriginAuthorityAssertionV2 | RetirementAuthorityAssertionV3;
} | {
    readonly status: "self_asserted";
    readonly reason: string;
} | {
    readonly status: "verification_failed";
    readonly reason: string;
};
export type RemoteApprovalDecision = {
    readonly decision: "yes";
    readonly entry: ApprovalDecisionEntry;
    readonly authority: RemoteAuthorityEvidence;
} | {
    readonly decision: "no";
    readonly entry: ApprovalDecisionEntry;
    readonly authority: RemoteAuthorityEvidence;
};
export type ResolveRemoteApprovalOptions = {
    /** Injectable clock for the gate-open timestamp (ISO-8601). Defaults to now. */
    readonly nowIso?: () => string;
    /** Status lines for the CLI (or other surfaces). Omitted = silent. */
    readonly onStatus?: (lines: readonly string[]) => void;
    /**
     * Extra bridge options (fetchImpl, waitBudgetMs, now, sleep, …).
     * `url` / `token` always come from `config` and are not overridable here.
     */
    readonly bridge?: Omit<BridgeOptions, "url" | "token">;
    /** Environment override for trust resolution (testability). */
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly retirementReadback?: {
        readonly storeDir: string;
        readonly readEnvelopeById: (storeDir: string, envelopeId: string) => UCPEnvelope<unknown> | null;
    };
    readonly mappedStorePolicy?: MappedStorePolicy;
    /** Internal surface discriminator. Web always forces "web" and no reader. */
    readonly surface?: "cli" | "web";
};
/**
 * Verify the signed authority assertion on a polled decision entry against
 * Core's pinned Portal trust anchor and the exact live gate. Pure except env.
 */
export declare function verifyRemoteEntryAuthority(input: {
    readonly entry: ApprovalDecisionEntry;
    readonly gate: PendingApprovalInput;
    readonly organizationId: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly retirementReadback?: ResolveRemoteApprovalOptions["retirementReadback"];
    readonly mappedStorePolicy?: MappedStorePolicy;
    readonly surface?: "cli" | "web";
}): RemoteAuthorityEvidence;
/**
 * Emit + poll Portal for this run's current gate. Returns a yes/no decision when
 * Portal returns a terminal approve/reject; returns null on unprojectable gate,
 * withdraw, or any fail-closed fallback (caller uses local decision).
 */
export declare function resolveRemoteApprovalDecision(run: WorkflowRun, config: Extract<PortalApprovalsConfig, {
    enabled: true;
}>, opts?: ResolveRemoteApprovalOptions): Promise<RemoteApprovalDecision | null>;
/**
 * Web `POST /confirm` decision resolution (S1).
 *
 * Default OFF (INV-LA-CFG1): when the env flag is unset or Portal config is
 * incomplete, returns `bodyYes` unchanged — byte-identical to today's handler.
 * Skips the bridge for `break_glass` (per-step confirm bypass by design).
 * On remote approve/reject, uses that decision; on null (timeout / fallback),
 * uses `bodyYes`. Never auto-approves from silence.
 */
export declare function resolveWebConfirmYes(input: {
    readonly run: WorkflowRun;
    readonly bodyYes: boolean;
    /** `USESTEADY_PENDING_APPROVAL_BRIDGE === "1"` (or equivalent). */
    readonly bridgeFlag: boolean;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly resolveRemote?: typeof resolveRemoteApprovalDecision;
    readonly remoteOpts?: ResolveRemoteApprovalOptions;
}): Promise<{
    readonly yes: boolean;
    readonly remote: RemoteApprovalDecision | null;
    readonly bridged: boolean;
}>;
//# sourceMappingURL=resolve-remote.d.ts.map