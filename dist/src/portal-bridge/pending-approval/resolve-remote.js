/**
 * Pending Approval Bridge — shared remote-decision resolver.
 *
 * Lifted from the CLI confirm-gate hook so CLI and web `POST /confirm` share one
 * path. Authority unchanged: Portal decision is an INPUT to Core's existing
 * `advanceWorkflowOnConfirm` gate; `approved` is necessary, not sufficient
 * (`requiresLocalRevalidation` / INV-LA-ENF1). Fail-closed outcomes return null
 * so the caller falls back to its local decision source (CLI prompt or HTTP body).
 */
import { AUTHORITY_DECISION_RELATION_RETIREMENT, AUTHORITY_DECISION_RELATION_SUPERSESSION, loadPortalAuthorityTrust, parseAuthorityAssertion, parseDecisionOriginAuthorityAssertionV2, parseRetirementAuthorityAssertionV3, pendingGateDecisionBasisFromInput, verifyAuthorityAssertion, verifyDecisionOriginAuthorityAssertionV2, verifyRetirementAuthorityAssertionV3, } from "../authority-assertion/index.js";
import { validateMappedStoreDir, } from "../../shell/defaults.js";
import { runPendingApprovalBridge, } from "./bridge.js";
import { pendingApprovalInputFromRun } from "./from-run.js";
import { resolvePortalApprovals, } from "./opt-in.js";
/**
 * Verify the signed authority assertion on a polled decision entry against
 * Core's pinned Portal trust anchor and the exact live gate. Pure except env.
 */
export function verifyRemoteEntryAuthority(input) {
    const resolution = loadPortalAuthorityTrust(input.env ?? process.env);
    if (resolution.status === "not_configured") {
        return { status: "self_asserted", reason: "pinning_not_configured" };
    }
    if (resolution.status === "misconfigured") {
        return { status: "verification_failed", reason: `trust_misconfigured: ${resolution.reason}` };
    }
    const raw = input.entry.authority_assertion;
    if (raw === undefined || raw === null) {
        return { status: "verification_failed", reason: "missing_assertion" };
    }
    if (!input.entry.decision || !input.entry.decided_at) {
        return { status: "verification_failed", reason: "incomplete_decision_entry" };
    }
    const parsedV3 = parseRetirementAuthorityAssertionV3(raw);
    const parsedV2 = parsedV3.ok ? { ok: false } : parseDecisionOriginAuthorityAssertionV2(raw);
    const parsedV1 = parsedV3.ok || parsedV2.ok ? null : parseAuthorityAssertion(raw);
    if (!parsedV3.ok && !parsedV2.ok && !parsedV1?.ok) {
        return { status: "verification_failed", reason: "malformed_assertion" };
    }
    const isV3 = parsedV3.ok;
    const isV2 = parsedV2.ok;
    // P3 / P5: an advisory gate demands the explicit relation recorded on the
    // polled entry (proceed_despite or retire_model_position), bound to the
    // exact preserved positions. An ordinary gate must never accept those fields.
    const advisoryExpectation = input.gate.modelAdvisories !== undefined && input.gate.modelAdvisories.length > 0;
    if ((isV2 || isV3) &&
        input.entry.decision_relation !== undefined &&
        input.entry.decision_relation !== null &&
        input.entry.decision_relation !== AUTHORITY_DECISION_RELATION_SUPERSESSION &&
        input.entry.decision_relation !== AUTHORITY_DECISION_RELATION_RETIREMENT) {
        return { status: "verification_failed", reason: "invalid_decision_relation" };
    }
    const relation = isV2 || isV3
        ? input.entry.decision_relation === AUTHORITY_DECISION_RELATION_SUPERSESSION
            ? AUTHORITY_DECISION_RELATION_SUPERSESSION
            : input.entry.decision_relation === AUTHORITY_DECISION_RELATION_RETIREMENT
                ? AUTHORITY_DECISION_RELATION_RETIREMENT
                : undefined
        : input.entry.decision_relation === AUTHORITY_DECISION_RELATION_RETIREMENT
            ? AUTHORITY_DECISION_RELATION_RETIREMENT
            : advisoryExpectation
                ? AUTHORITY_DECISION_RELATION_SUPERSESSION
                : undefined;
    const resolvingIds = relation === AUTHORITY_DECISION_RELATION_RETIREMENT
        ? (input.entry.resolving_evidence_ids ??
            (input.gate.modelAdvisories ?? [])
                .map((a) => a.evidenceBasisId)
                .filter((id) => typeof id === "string"))
        : undefined;
    const expected = {
        organization_id: input.organizationId,
        run_id: input.gate.runId,
        thread_id: null,
        step_index: input.gate.stepIndex,
        decision: input.entry.decision,
        decided_at: input.entry.decided_at,
        decision_basis: pendingGateDecisionBasisFromInput(input.gate),
        approver_display: input.entry.decided_by,
        ...(input.entry.id ? { decision_id: input.entry.id } : {}),
        gate_cycle: input.gate.gateCycle ?? 0,
        ...(advisoryExpectation && relation !== undefined
            ? {
                decision_relation: relation,
                model_positions: (input.gate.modelAdvisories ?? []).map((a) => ({
                    model_position_id: a.modelPositionId,
                    position_hash: a.positionHash,
                })),
                ...(resolvingIds !== undefined && resolvingIds.length > 0
                    ? { resolving_evidence_ids: resolvingIds }
                    : {}),
                ...(relation === AUTHORITY_DECISION_RELATION_RETIREMENT
                    ? {
                        retirement_basis_relations: (input.gate.modelAdvisories ?? [])
                            .filter((a) => a.evidenceBasisRef !== undefined)
                            .map((a) => ({
                            model_position: {
                                model_position_id: a.modelPositionId,
                                position_hash: a.positionHash,
                            },
                            resolving_evidence: {
                                evidence_basis_id: a.evidenceBasisRef.evidenceBasisId,
                                evidence_basis_hash: a.evidenceBasisRef.evidenceBasisHash,
                            },
                        })),
                    }
                    : {}),
            }
            : {}),
    };
    if (isV3) {
        if (input.surface === "web") {
            const structuralExpected = expected.retirement_basis_relations;
            if (structuralExpected === undefined ||
                structuralExpected.length !== (input.gate.modelAdvisories ?? []).length) {
                return { status: "verification_failed", reason: "mapped_relation_reference_missing" };
            }
            const artifactId = input.gate.modelAdvisories?.[0]?.artifactId;
            if (!artifactId) {
                return { status: "verification_failed", reason: "binding_mismatch:artifact_id" };
            }
            const verified = verifyRetirementAuthorityAssertionV3(raw, resolution.trust, expected, {
                storeDir: "",
                artifactId,
                readEnvelopeById: () => {
                    throw new Error("web has no mapped reader");
                },
            });
            if (!verified.ok &&
                verified.reason !== "mapped_store_unavailable")
                return { status: "verification_failed", reason: verified.reason };
            return {
                status: "self_asserted",
                reason: "mapped_store_configuration_required",
            };
        }
        if (!input.retirementReadback) {
            return { status: "verification_failed", reason: "mapped_store_configuration_required" };
        }
        const policy = (input.mappedStorePolicy ?? validateMappedStoreDir)(input.retirementReadback.storeDir);
        if (!policy.ok)
            return { status: "verification_failed", reason: policy.code };
        const artifactId = input.gate.modelAdvisories?.[0]?.artifactId;
        if (!artifactId)
            return { status: "verification_failed", reason: "binding_mismatch:artifact_id" };
        const result = verifyRetirementAuthorityAssertionV3(raw, resolution.trust, expected, {
            storeDir: policy.canonicalStoreDir,
            artifactId,
            readEnvelopeById: input.retirementReadback.readEnvelopeById,
        });
        if (!result.ok)
            return { status: "verification_failed", reason: result.reason };
        return { status: "portal_signed_verified", assertion: result.assertion };
    }
    const result = isV2
        ? verifyDecisionOriginAuthorityAssertionV2(raw, resolution.trust, expected)
        : verifyAuthorityAssertion(raw, resolution.trust, expected);
    if (!result.ok)
        return { status: "verification_failed", reason: result.reason };
    if (!isV2) {
        return { status: "self_asserted", reason: "pending_v1_compatibility_weak" };
    }
    return { status: "portal_signed_verified", assertion: parsedV2.assertion };
}
/**
 * Emit + poll Portal for this run's current gate. Returns a yes/no decision when
 * Portal returns a terminal approve/reject; returns null on unprojectable gate,
 * withdraw, or any fail-closed fallback (caller uses local decision).
 */
export async function resolveRemoteApprovalDecision(run, config, opts = {}) {
    const nowIso = opts.nowIso ?? (() => new Date().toISOString());
    const onStatus = opts.onStatus;
    const input = pendingApprovalInputFromRun(run, nowIso());
    if (!input)
        return null; // no projectable gate -> local approval flow
    onStatus?.(["  Waiting for approval in the Portal (or fall back to local on timeout)..."]);
    const outcome = await runPendingApprovalBridge(input, {
        url: config.url,
        token: config.token,
        ...(opts.bridge ?? {}),
    });
    switch (outcome.kind) {
        case "approved": {
            const authority = verifyRemoteEntryAuthority({
                entry: outcome.entry,
                gate: input,
                organizationId: config.token,
                ...(opts.env ? { env: opts.env } : {}),
                ...(opts.retirementReadback ? { retirementReadback: opts.retirementReadback } : {}),
                ...(opts.mappedStorePolicy ? { mappedStorePolicy: opts.mappedStorePolicy } : {}),
                surface: opts.surface ?? "cli",
            });
            if (authority.status === "verification_failed") {
                // FAIL CLOSED: with pinning configured, an approve whose authority
                // evidence is absent/invalid is never consumed — degrade to the local
                // approval flow (INV-LA-AUTH3 posture), never auto-approve.
                onStatus?.([
                    `  Portal approval evidence failed verification (${authority.reason}). Falling back to local approval.`,
                ]);
                return null;
            }
            if (authority.status === "portal_signed_verified") {
                const origin = authority.assertion.payload.decision_origin;
                onStatus?.([
                    `  Portal authority verified (key ${authority.assertion.payload.key_id}, subject ${origin.authority_subject_id}).`,
                ]);
            }
            // Necessary, not sufficient: advanceWorkflowOnConfirm re-validates locally.
            onStatus?.(["  Approved in the Portal. Re-validating locally before any step runs."]);
            return { decision: "yes", entry: outcome.entry, authority };
        }
        case "rejected": {
            // A reject is fail-safe: honor it regardless of evidence status, but
            // record the authority evidence honestly for the audit trail.
            const authority = verifyRemoteEntryAuthority({
                entry: outcome.entry,
                gate: input,
                organizationId: config.token,
                ...(opts.env ? { env: opts.env } : {}),
                ...(opts.retirementReadback ? { retirementReadback: opts.retirementReadback } : {}),
                ...(opts.mappedStorePolicy ? { mappedStorePolicy: opts.mappedStorePolicy } : {}),
                surface: opts.surface ?? "cli",
            });
            onStatus?.(["  Rejected in the Portal."]);
            return { decision: "no", entry: outcome.entry, authority };
        }
        case "withdrawn":
            // Unexpected in the emit-only flow; reconcile via the local decision source.
            onStatus?.(["  Gate withdrawn upstream. Falling back to local approval."]);
            return null;
        case "fallback_local":
            onStatus?.([
                `  Portal approval unavailable (${outcome.reason}). Falling back to local approval.`,
            ]);
            return null;
    }
}
/**
 * Web `POST /confirm` decision resolution (S1).
 *
 * Default OFF (INV-LA-CFG1): when the env flag is unset or Portal config is
 * incomplete, returns `bodyYes` unchanged — byte-identical to today's handler.
 * Skips the bridge for `break_glass` (per-step confirm bypass by design).
 * On remote approve/reject, uses that decision; on null (timeout / fallback),
 * uses `bodyYes`. Never auto-approves from silence.
 */
export async function resolveWebConfirmYes(input) {
    const approvalsConfig = resolvePortalApprovals({
        flag: input.bridgeFlag,
        ...(input.env ? { env: input.env } : {}),
    });
    if (!approvalsConfig.enabled || input.run.mode === "break_glass") {
        return { yes: input.bodyYes, remote: null, bridged: false };
    }
    const resolveRemote = input.resolveRemote ?? resolveRemoteApprovalDecision;
    const { retirementReadback: _forbiddenReader, ...safeRemoteOpts } = input.remoteOpts ?? {};
    const remote = await resolveRemote(input.run, approvalsConfig, {
        ...safeRemoteOpts,
        ...(input.env ? { env: input.env } : {}),
        surface: "web",
    });
    if (remote === null) {
        // fallback_local / withdrawn / unprojectable — use HTTP body (never invent yes).
        return { yes: input.bodyYes, remote: null, bridged: true };
    }
    return { yes: remote.decision === "yes", remote, bridged: true };
}
//# sourceMappingURL=resolve-remote.js.map