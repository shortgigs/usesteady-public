/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - pure payload builder.
 *
 * `buildExecutionReturnPayload` takes an already-extracted, already-redacted
 * normalized input and produces a frozen, bounds-enforced `ucp.execution_return.v1`
 * wire payload. It is PURE: no network, no filesystem, no clock, no env reads.
 * (Mapping UCP + execution.db into `ExecutionReturnInput`, applying the on-machine
 * redaction allowlist, and the actual HTTPS POST are the next P0-49 step - kept
 * out of this unit so the wire shape can be tested in isolation.)
 *
 * `validateExecutionReturnPayload` is the fail-closed gate the transport step
 * will call BEFORE sending: a payload that does not validate is never POSTed.
 * It mirrors the Portal-side 400 contract so both lanes agree on "well-typed".
 *
 * Privacy: the input type carries no contents/diffs (INV-ERB-P2); resources are
 * assumed already redacted on the machine (INV-ERB-P3) before reaching here.
 */
import { AFFECTED_RESOURCES_LIMIT, EXECUTION_RETURN_SCHEMA, } from "./types.js";
const OUTCOMES = ["success", "failure", "partial"];
const APPROVAL_MODES = ["per_step", "break_glass"];
const CHANGE_TYPES = ["create", "update", "delete", "rename"];
/**
 * Build the frozen wire payload from normalized input.
 *
 * Bounds rule (contract "Bounds & rules"): when `affectedResources` exceeds
 * AFFECTED_RESOURCES_LIMIT, only the first N are carried, `*_truncated` is true,
 * and `*_total` holds the true pre-truncation count.
 */
export function buildExecutionReturnPayload(input) {
    const chainCount = Math.max(0, Math.trunc(input.chainCount));
    const base = {
        schema: EXECUTION_RETURN_SCHEMA,
        run_id: input.runId,
        ucp_root_id: input.ucpRootId,
        ucp_bundle_hash: input.ucpBundleHash ?? null,
        workflow_name: input.workflowName ?? null,
        outcome: input.outcome,
        executed_at: input.executedAt,
        decision_summary: input.decisionSummary,
        approval_record: input.approvalRecord,
        chain_ref: {
            available: input.chainAvailable ?? chainCount > 0,
            count: chainCount,
            fetch: "on_demand",
        },
    };
    const withReplay = input.replayRef
        ? {
            ...base,
            replay_ref: {
                reconstructable: input.replayRef.reconstructable === true,
                checksum: input.replayRef.reconstructable === true && isNonEmptyString(input.replayRef.checksum)
                    ? input.replayRef.checksum.trim()
                    : null,
            },
        }
        : base;
    const cv = input.chainVerification;
    const withChainVerification = cv && Array.isArray(cv.entry_ids) && cv.entry_ids.length > 0
        ? {
            ...withReplay,
            chain_verification: {
                entry_ids: cv.entry_ids.slice(),
                cumulative_hash: cv.cumulative_hash,
                merkle_root: cv.merkle_root,
                algorithm: "sha256",
            },
        }
        : withReplay;
    const withResume = input.resumeTokenMeta
        ? { ...withChainVerification, resume_token_meta: input.resumeTokenMeta }
        : withChainVerification;
    const ov = input.outcomeVerification;
    const withOutcome = ov
        ? {
            ...withResume,
            outcome_verification: {
                status: ov.status,
                executor_report: ov.executor_report,
                observation: ov.observation,
                ...(ov.reality_verdict !== undefined ? { reality_verdict: ov.reality_verdict } : {}),
                ...(ov.intended_vs_actual !== undefined
                    ? { intended_vs_actual: ov.intended_vs_actual }
                    : {}),
            },
        }
        : withResume;
    const drs = input.deliveryReportSummary;
    const withDelivery = drs
        ? {
            ...withOutcome,
            delivery_report_summary: {
                basis: "executor_delivery_report",
                total: drs.total,
                accepted: drs.accepted,
                rejected: drs.rejected,
                skipped: drs.skipped,
                pending: drs.pending,
                stopped: drs.stopped,
                other: drs.other,
            },
        }
        : withOutcome;
    if (!input.affectedResources) {
        return withDelivery;
    }
    const total = input.affectedResources.length;
    const truncated = total > AFFECTED_RESOURCES_LIMIT;
    const list = truncated
        ? input.affectedResources.slice(0, AFFECTED_RESOURCES_LIMIT)
        : input.affectedResources;
    return {
        ...withDelivery,
        affected_resources: list,
        affected_resources_total: total,
        affected_resources_truncated: truncated,
    };
}
function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
}
function isNonNegativeInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
function isIsoTimestamp(v) {
    return isNonEmptyString(v) && !Number.isNaN(Date.parse(v));
}
/**
 * Fail-closed validation. The transport step must call this before POSTing and
 * must NOT send when `ok === false`. Mirrors the Portal-side 400 contract so a
 * payload this function accepts is one the Portal endpoint will accept on type
 * grounds (auth + idempotency are separate, server-side concerns).
 */
export function validateExecutionReturnPayload(payload) {
    const errors = [];
    if (payload.schema !== EXECUTION_RETURN_SCHEMA) {
        errors.push(`schema must be "${EXECUTION_RETURN_SCHEMA}"`);
    }
    if (!isNonEmptyString(payload.run_id))
        errors.push("run_id must be a non-empty string");
    if (!isNonEmptyString(payload.ucp_root_id))
        errors.push("ucp_root_id must be a non-empty string");
    if (!OUTCOMES.includes(payload.outcome)) {
        errors.push(`outcome must be one of ${OUTCOMES.join(" | ")}`);
    }
    if (!isIsoTimestamp(payload.executed_at)) {
        errors.push("executed_at must be an ISO-8601 timestamp");
    }
    const ds = payload.decision_summary;
    if (!ds || typeof ds !== "object") {
        errors.push("decision_summary is required");
    }
    else {
        for (const k of ["total_steps", "approved", "rejected", "executed", "skipped"]) {
            if (!isNonNegativeInt(ds[k]))
                errors.push(`decision_summary.${k} must be a non-negative integer`);
        }
        if (typeof ds.break_glass !== "boolean")
            errors.push("decision_summary.break_glass must be a boolean");
        const availabilityBases = ["explicit_human_decision", "not_available"];
        if (ds.approved_basis !== undefined && !availabilityBases.includes(ds.approved_basis)) {
            errors.push("decision_summary.approved_basis must be explicit_human_decision|not_available when present");
        }
        if (ds.rejected_basis !== undefined && !availabilityBases.includes(ds.rejected_basis)) {
            errors.push("decision_summary.rejected_basis must be explicit_human_decision|not_available when present");
        }
        if (ds.skipped_basis !== undefined && !availabilityBases.includes(ds.skipped_basis)) {
            errors.push("decision_summary.skipped_basis must be explicit_human_decision|not_available when present");
        }
        // executed: 0 / not_established = unknown-by-this-field, not non-execution.
        if (ds.executed_basis !== undefined && ds.executed_basis !== "not_established") {
            errors.push("decision_summary.executed_basis must be not_established when present");
        }
        if (ds.executed_basis === "not_established" && ds.executed !== 0) {
            errors.push("decision_summary.executed must be 0 when executed_basis is not_established");
        }
    }
    if (payload.delivery_report_summary !== undefined) {
        const drs = payload.delivery_report_summary;
        if (!drs || typeof drs !== "object") {
            errors.push("delivery_report_summary, when present, must be an object");
        }
        else {
            if (drs.basis !== "executor_delivery_report") {
                errors.push('delivery_report_summary.basis must be "executor_delivery_report"');
            }
            for (const k of ["total", "accepted", "rejected", "skipped", "pending", "stopped", "other"]) {
                if (!isNonNegativeInt(drs[k])) {
                    errors.push(`delivery_report_summary.${k} must be a non-negative integer`);
                }
            }
            if (isNonNegativeInt(drs.total) &&
                isNonNegativeInt(drs.accepted) &&
                isNonNegativeInt(drs.rejected) &&
                isNonNegativeInt(drs.skipped) &&
                isNonNegativeInt(drs.pending) &&
                isNonNegativeInt(drs.stopped) &&
                isNonNegativeInt(drs.other) &&
                drs.accepted + drs.rejected + drs.skipped + drs.pending + drs.stopped + drs.other !==
                    drs.total) {
                errors.push("delivery_report_summary.accepted+rejected+skipped+pending+stopped+other must equal total");
            }
        }
    }
    const ar = payload.approval_record;
    if (!ar || typeof ar !== "object") {
        errors.push("approval_record is required");
    }
    else {
        if (!APPROVAL_MODES.includes(ar.mode)) {
            errors.push(`approval_record.mode must be one of ${APPROVAL_MODES.join(" | ")}`);
        }
        if (ar.approver !== null && typeof ar.approver !== "string") {
            errors.push("approval_record.approver must be a string or null");
        }
        if (ar.approved_at !== null && !isIsoTimestamp(ar.approved_at)) {
            errors.push("approval_record.approved_at must be an ISO-8601 timestamp or null");
        }
        // P1 authority carry: optional; when present the status label must be one of
        // the two honest values. The assertion envelope itself is opaque here (the
        // Portal re-verifies it independently).
        if (ar.authority_status !== undefined &&
            ar.authority_status !== "portal_signed_verified" &&
            ar.authority_status !== "self_asserted") {
            errors.push("approval_record.authority_status must be portal_signed_verified|self_asserted when present");
        }
    }
    const cr = payload.chain_ref;
    if (!cr || typeof cr !== "object") {
        errors.push("chain_ref is required");
    }
    else {
        if (typeof cr.available !== "boolean")
            errors.push("chain_ref.available must be a boolean");
        if (!isNonNegativeInt(cr.count))
            errors.push("chain_ref.count must be a non-negative integer");
        if (cr.fetch !== "on_demand")
            errors.push('chain_ref.fetch must be "on_demand"');
    }
    // P0-55: replay_ref is optional; when present it must be coherent. A
    // reconstructable=true with no checksum is incoherent (mirrors the Portal gate).
    if (payload.replay_ref !== undefined) {
        const rr = payload.replay_ref;
        if (!rr || typeof rr !== "object") {
            errors.push("replay_ref, when present, must be an object");
        }
        else {
            if (typeof rr.reconstructable !== "boolean") {
                errors.push("replay_ref.reconstructable must be a boolean");
            }
            if (rr.checksum !== null && typeof rr.checksum !== "string") {
                errors.push("replay_ref.checksum must be a string or null");
            }
            if (rr.reconstructable === true && !isNonEmptyString(rr.checksum)) {
                errors.push("replay_ref.checksum must be a non-empty string when reconstructable is true");
            }
        }
    }
    // P0-57: chain_verification is optional; when present it must be coherent.
    // entry_ids must be a non-empty array of non-empty strings; both hashes
    // non-empty; algorithm literal "sha256". Content-hash ids only (INV-ERB-P2).
    if (payload.chain_verification !== undefined) {
        const cv = payload.chain_verification;
        if (!cv || typeof cv !== "object") {
            errors.push("chain_verification, when present, must be an object");
        }
        else {
            if (!Array.isArray(cv.entry_ids) ||
                cv.entry_ids.length === 0 ||
                !cv.entry_ids.every((x) => isNonEmptyString(x))) {
                errors.push("chain_verification.entry_ids must be a non-empty array of non-empty strings");
            }
            if (!isNonEmptyString(cv.cumulative_hash)) {
                errors.push("chain_verification.cumulative_hash must be a non-empty string");
            }
            if (!isNonEmptyString(cv.merkle_root)) {
                errors.push("chain_verification.merkle_root must be a non-empty string");
            }
            if (cv.algorithm !== "sha256") {
                errors.push('chain_verification.algorithm must be "sha256"');
            }
            if (Array.isArray(cv.entry_ids) &&
                cv.entry_ids.length > 0 &&
                cv.entry_ids.every((x) => isNonEmptyString(x))) {
                if (new Set(cv.entry_ids).size !== cv.entry_ids.length) {
                    errors.push("chain_verification.entry_ids must be unique");
                }
                if (cv.entry_ids[0] !== payload.ucp_root_id) {
                    errors.push("chain_verification.entry_ids[0] must equal ucp_root_id");
                }
                if (payload.chain_ref && payload.chain_ref.available !== true) {
                    errors.push("chain_ref.available must be true when chain_verification is present");
                }
                if (payload.chain_ref &&
                    isNonNegativeInt(payload.chain_ref.count) &&
                    payload.chain_ref.count !== cv.entry_ids.length) {
                    errors.push("chain_ref.count must equal chain_verification.entry_ids.length");
                }
            }
        }
    }
    if (payload.outcome_verification !== undefined) {
        const ov = payload.outcome_verification;
        const statuses = ["verified", "disagreement", "unknown", "unverified"];
        const reports = ["accepted", "failed"];
        const observations = ["agree", "disagree", "unknown", "not_observed"];
        const verdicts = ["agree", "disagree", "unknown"];
        if (!ov || typeof ov !== "object") {
            errors.push("outcome_verification, when present, must be an object");
        }
        else {
            if (!statuses.includes(ov.status)) {
                errors.push("outcome_verification.status is not a known status");
            }
            if (!reports.includes(ov.executor_report)) {
                errors.push("outcome_verification.executor_report must be accepted|failed");
            }
            if (!observations.includes(ov.observation)) {
                errors.push("outcome_verification.observation is not a known observation");
            }
            if (ov.reality_verdict !== undefined && !verdicts.includes(ov.reality_verdict)) {
                errors.push("outcome_verification.reality_verdict must be agree|disagree|unknown");
            }
        }
    }
    if (payload.affected_resources !== undefined) {
        if (payload.affected_resources.length > AFFECTED_RESOURCES_LIMIT) {
            errors.push(`affected_resources exceeds the cap of ${AFFECTED_RESOURCES_LIMIT}`);
        }
        for (const r of payload.affected_resources) {
            if (!isNonEmptyString(r.path))
                errors.push("affected_resources[].path must be a non-empty string");
            if (!CHANGE_TYPES.includes(r.change_type)) {
                errors.push(`affected_resources[].change_type must be one of ${CHANGE_TYPES.join(" | ")}`);
            }
        }
        // Truncation flags must be self-consistent when resources are present.
        if (payload.affected_resources_truncated === true && payload.affected_resources.length < AFFECTED_RESOURCES_LIMIT) {
            errors.push("affected_resources_truncated is true but the list is below the cap");
        }
        if (typeof payload.affected_resources_total === "number" &&
            payload.affected_resources_total < payload.affected_resources.length) {
            errors.push("affected_resources_total is less than the carried list length");
        }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
//# sourceMappingURL=build-payload.js.map