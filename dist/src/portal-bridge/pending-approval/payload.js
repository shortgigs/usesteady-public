/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - pure payload
 * builder + validator for the Core -> Portal emit.
 *
 * Direction: Core -> Portal `POST /api/v1/pending-approvals` when a run reaches a
 * pre-execution approval gate. This module owns the frozen `ucp.pending_approval.v1`
 * wire shape and is PURE: no network, no filesystem, no clock, no env reads. The
 * opt-in resolution, the HTTPS POST, and the gate hook are later PRs - kept out of
 * this unit so the wire shape can be tested in isolation (mirrors the sibling
 * EXECUTION_RETURN_BRIDGE_V1 build-payload module).
 *
 * Authority: this bridge is a remote INPUT to Core's existing approval gate, never
 * a new authority and never an executor (INV-LA-AUTH1/AUTH4). Building a payload
 * publishes "a gate is open"; it does not run, approve, or skip anything.
 *
 * Privacy (INV-PAB-P2 / INV-LA-EMIT1): there is deliberately NO field for file
 * contents or diffs. The type system itself prevents content from reaching the
 * wire - only a SYSTEM WILL summary, resource paths + change-types, counts, and a
 * risk band exist here. Resources are assumed already redacted on the machine
 * before they reach this builder.
 *
 * Evolution: additive only (new OPTIONAL fields). Any breaking change requires a
 * new schema id `ucp.pending_approval.v2` and a v2 contract - never an in-place
 * edit of these types.
 *
 * Frozen wire contract: PENDING_APPROVAL_BRIDGE_V1
 * (docs/product/pending-approval-bridge-contract-v1.md, authored in usesteady-ops).
 */
/** Frozen schema discriminator. Literal type - any other value is a bug. */
export const PENDING_APPROVAL_SCHEMA = "ucp.pending_approval.v1";
/**
 * Recommended cap on `affected_resources` entries (contract "Bounds & rules").
 * When a gate touches more than this, the payload carries the first N and sets
 * `affected_resources_truncated: true` with the true count in
 * `affected_resources_total`. Defined locally (not imported from the return
 * bridge) so the two bridges stay independent; the contract recommends 200 for
 * each. Matches the Lane B (Portal) cap of the same name.
 */
export const PENDING_AFFECTED_RESOURCES_LIMIT = 200;
export const PENDING_MODEL_ADVISORY_KINDS = [
    "warning",
    "recommend_against",
    "uncertainty",
    "alternative",
];
/** Max advisory positions carried on one gate. */
export const PENDING_MODEL_ADVISORIES_LIMIT = 8;
/** Max characters per advisory explanation on the wire. */
export const PENDING_MODEL_ADVISORY_EXPLANATION_LIMIT = 4000;
// ─── Evidence-basis carriage (P4) ─────────────────────────────────────────────
/**
 * Closed availability vocabulary for one evidence source on the wire. Mirrors
 * src/evidence-basis/types.ts (Core) — duplicated here so the bridge stays
 * dependency-free; the two MUST NOT drift apart.
 */
export const PENDING_EVIDENCE_AVAILABILITY = [
    "available_and_corresponded",
    "not_provided",
    "partial",
    "retrieval_failed",
    "correspondence_not_established",
    "unknown",
];
/** Max evidence sources carried per advisory. */
export const PENDING_EVIDENCE_SOURCES_LIMIT = 8;
/** Max characters per evidence-source detail note on the wire. */
export const PENDING_EVIDENCE_DETAIL_LIMIT = 280;
const RISKS = ["low", "medium", "high"];
const ACTION_TYPES = [
    "create",
    "update",
    "delete",
    "rename",
    "other",
];
const CHANGE_TYPES = ["create", "update", "delete", "rename"];
/**
 * Build the frozen wire payload from normalized input.
 *
 * Bounds rule (contract "Bounds & rules"): when `affectedResources` exceeds
 * PENDING_AFFECTED_RESOURCES_LIMIT, only the first N are carried,
 * `affected_resources_truncated` is true, and `affected_resources_total` holds the
 * true pre-truncation count.
 */
export function buildPendingApprovalPayload(input) {
    const stepIndex = Math.max(0, Math.trunc(input.stepIndex));
    let systemWill = {
        summary: input.summary,
        action_type: input.actionType,
    };
    if (input.affectedResources) {
        const total = input.affectedResources.length;
        const truncated = total > PENDING_AFFECTED_RESOURCES_LIMIT;
        const list = truncated
            ? input.affectedResources.slice(0, PENDING_AFFECTED_RESOURCES_LIMIT)
            : input.affectedResources;
        systemWill = {
            ...systemWill,
            affected_resources: list,
            affected_resources_total: total,
            affected_resources_truncated: truncated,
        };
    }
    const base = {
        schema: PENDING_APPROVAL_SCHEMA,
        run_id: input.runId,
        step_index: stepIndex,
        ucp_root_id: input.ucpRootId ?? null,
        workflow_name: input.workflowName ?? null,
        system_will: systemWill,
        risk: input.risk,
        requested_by: input.requestedBy ?? null,
        requested_at: input.requestedAt,
    };
    // ttl_seconds is omitted entirely when 0/absent/non-positive (contract: 0/absent
    // = no TTL). Only a positive integer rides the wire.
    const ttl = typeof input.ttlSeconds === "number" &&
        Number.isFinite(input.ttlSeconds) &&
        input.ttlSeconds > 0
        ? Math.trunc(input.ttlSeconds)
        : null;
    const withTtl = ttl !== null ? { ...base, ttl_seconds: ttl } : base;
    // withdraw is omitted unless explicitly true (absent = a normal pending post).
    const withWithdraw = input.withdraw === true ? { ...withTtl, withdraw: true } : withTtl;
    // P3 Phase 2: advisory carriage + gate cycle — omitted entirely when absent
    // (additive; old wire bytes for ordinary gates are unchanged).
    const advisories = input.modelAdvisories;
    const withAdvisories = advisories !== undefined && advisories.length > 0
        ? {
            ...withWithdraw,
            model_advisories: advisories.map((a) => ({
                model_position_id: a.modelPositionId,
                position_hash: a.positionHash,
                kind: a.kind,
                explanation: a.explanation,
                // P4: carry the system-derived evidence basis when present;
                // omitted entirely for legacy advisories (never synthesized).
                ...(a.evidenceBasis !== undefined
                    ? {
                        evidence_basis: {
                            derivation: a.evidenceBasis.derivation,
                            sources: a.evidenceBasis.sources.map((s) => ({
                                source: s.source,
                                availability: s.availability,
                                ...(s.detail !== undefined ? { detail: s.detail } : {}),
                            })),
                            evidence_backed_contradiction: a.evidenceBasis.evidenceBackedContradiction,
                            comprehension: a.evidenceBasis.comprehension,
                        },
                    }
                    : {}),
                ...(a.evidenceBasisId !== undefined
                    ? { evidence_basis_id: a.evidenceBasisId }
                    : {}),
                ...(a.evidenceBasisRef !== undefined
                    ? {
                        evidence_basis_ref: {
                            evidence_basis_id: a.evidenceBasisRef.evidenceBasisId,
                            evidence_basis_hash: a.evidenceBasisRef.evidenceBasisHash,
                        },
                    }
                    : {}),
            })),
        }
        : withWithdraw;
    const gateCycle = typeof input.gateCycle === "number" &&
        Number.isInteger(input.gateCycle) &&
        input.gateCycle > 0
        ? input.gateCycle
        : null;
    return gateCycle !== null ? { ...withAdvisories, gate_cycle: gateCycle } : withAdvisories;
}
function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
}
function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonNegativeInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
function isPositiveInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v > 0;
}
function isIsoTimestamp(v) {
    return isNonEmptyString(v) && !Number.isNaN(Date.parse(v));
}
/**
 * Fail-closed validation. The transport step MUST call this before POSTing and
 * MUST NOT send when `ok === false`. It mirrors the Lane B (Portal) acceptance
 * contract (`validatePendingApprovalPayload`) so a payload this function accepts
 * is one the Portal endpoint will accept on type grounds (auth + idempotency are
 * separate, server-side concerns). Required fields - including system_will/risk/
 * requested_at - are required even for a withdraw, matching the Portal.
 */
export function validatePendingApprovalPayload(payload) {
    const errors = [];
    if (payload.schema !== PENDING_APPROVAL_SCHEMA) {
        errors.push(`schema must be "${PENDING_APPROVAL_SCHEMA}"`);
    }
    if (!isNonEmptyString(payload.run_id))
        errors.push("run_id must be a non-empty string");
    if (!isNonNegativeInt(payload.step_index)) {
        errors.push("step_index must be a non-negative integer");
    }
    if (!RISKS.includes(payload.risk)) {
        errors.push(`risk must be one of ${RISKS.join(" | ")}`);
    }
    if (!isIsoTimestamp(payload.requested_at)) {
        errors.push("requested_at must be an ISO-8601 timestamp");
    }
    if (payload.ucp_root_id !== null && typeof payload.ucp_root_id !== "string") {
        errors.push("ucp_root_id must be a string or null");
    }
    if (payload.workflow_name !== null && typeof payload.workflow_name !== "string") {
        errors.push("workflow_name must be a string or null");
    }
    if (payload.requested_by !== null && typeof payload.requested_by !== "string") {
        errors.push("requested_by must be a string or null");
    }
    if (payload.ttl_seconds !== undefined && !isPositiveInt(payload.ttl_seconds)) {
        errors.push("ttl_seconds, when present, must be a positive integer");
    }
    if (payload.withdraw !== undefined && typeof payload.withdraw !== "boolean") {
        errors.push("withdraw, when present, must be a boolean");
    }
    if (payload.gate_cycle !== undefined && !isNonNegativeInt(payload.gate_cycle)) {
        errors.push("gate_cycle, when present, must be a non-negative integer");
    }
    // P3 Phase 2: model advisory carriage — validated when present, omitted by
    // default. ids are sha256 hex digests (64 lowercase hex chars).
    if (payload.model_advisories !== undefined) {
        const advs = payload.model_advisories;
        if (!Array.isArray(advs)) {
            errors.push("model_advisories, when present, must be an array");
        }
        else {
            if (advs.length > PENDING_MODEL_ADVISORIES_LIMIT) {
                errors.push(`model_advisories exceeds the cap of ${PENDING_MODEL_ADVISORIES_LIMIT}`);
            }
            const seenO = new Set();
            const seenModelIds = new Map();
            const seenE = new Set();
            for (const a of advs) {
                if (!a || typeof a !== "object") {
                    errors.push("model_advisories[] must be objects");
                    continue;
                }
                if (!/^[0-9a-f]{64}$/.test(a.model_position_id)) {
                    errors.push("model_advisories[].model_position_id must be a 64-char lowercase sha256 hex digest");
                }
                if (!/^[0-9a-f]{64}$/.test(a.position_hash)) {
                    errors.push("model_advisories[].position_hash must be a 64-char lowercase sha256 hex digest");
                }
                if (!PENDING_MODEL_ADVISORY_KINDS.includes(a.kind)) {
                    errors.push(`model_advisories[].kind must be one of ${PENDING_MODEL_ADVISORY_KINDS.join(" | ")}`);
                }
                if (!isNonEmptyString(a.explanation)) {
                    errors.push("model_advisories[].explanation must be a non-empty string");
                }
                else if (a.explanation.length > PENDING_MODEL_ADVISORY_EXPLANATION_LIMIT) {
                    errors.push(`model_advisories[].explanation exceeds the cap of ${PENDING_MODEL_ADVISORY_EXPLANATION_LIMIT} chars`);
                }
                // P4: evidence basis — validated when present, omitted by default.
                // Fail-closed: any value other than the literal "not_established" on
                // the judgment-boundary fields is a wire error; the wire cannot carry
                // an overclaim of contradiction or comprehension.
                if (a.evidence_basis !== undefined) {
                    const eb = a.evidence_basis;
                    if (!eb || typeof eb !== "object") {
                        errors.push("model_advisories[].evidence_basis must be an object");
                    }
                    else {
                        if (eb.derivation !== "system_structural_v1") {
                            errors.push('model_advisories[].evidence_basis.derivation must be "system_structural_v1"');
                        }
                        if (eb.evidence_backed_contradiction !== "not_established") {
                            errors.push('model_advisories[].evidence_basis.evidence_backed_contradiction must be "not_established"');
                        }
                        if (eb.comprehension !== "not_established") {
                            errors.push('model_advisories[].evidence_basis.comprehension must be "not_established"');
                        }
                        if (!Array.isArray(eb.sources)) {
                            errors.push("model_advisories[].evidence_basis.sources must be an array");
                        }
                        else {
                            if (eb.sources.length > PENDING_EVIDENCE_SOURCES_LIMIT) {
                                errors.push(`model_advisories[].evidence_basis.sources exceeds the cap of ${PENDING_EVIDENCE_SOURCES_LIMIT}`);
                            }
                            for (const s of eb.sources) {
                                if (!s || typeof s !== "object") {
                                    errors.push("model_advisories[].evidence_basis.sources[] must be objects");
                                    continue;
                                }
                                if (!isNonEmptyString(s.source)) {
                                    errors.push("model_advisories[].evidence_basis.sources[].source must be a non-empty string");
                                }
                                if (!PENDING_EVIDENCE_AVAILABILITY.includes(s.availability)) {
                                    errors.push(`model_advisories[].evidence_basis.sources[].availability must be one of ${PENDING_EVIDENCE_AVAILABILITY.join(" | ")}`);
                                }
                                if (s.detail !== undefined) {
                                    if (typeof s.detail !== "string") {
                                        errors.push("model_advisories[].evidence_basis.sources[].detail must be a string");
                                    }
                                    else if (s.detail.length > PENDING_EVIDENCE_DETAIL_LIMIT) {
                                        errors.push(`model_advisories[].evidence_basis.sources[].detail exceeds the cap of ${PENDING_EVIDENCE_DETAIL_LIMIT} chars`);
                                    }
                                }
                            }
                        }
                    }
                }
                if (a.evidence_basis_id !== undefined && !/^[0-9a-f]{64}$/.test(a.evidence_basis_id)) {
                    errors.push("model_advisories[].evidence_basis_id must be a 64-char lowercase sha256 hex digest");
                }
                const pair = `${a.model_position_id}:${a.position_hash}`;
                if (seenO.has(pair))
                    errors.push("model_advisories[] contains a duplicate O pair");
                seenO.add(pair);
                const priorHash = seenModelIds.get(a.model_position_id);
                if (priorHash !== undefined && priorHash !== a.position_hash) {
                    errors.push("model_advisories[] contains one model_position_id with conflicting position_hash values");
                }
                seenModelIds.set(a.model_position_id, a.position_hash);
                if (a.evidence_basis_ref !== undefined) {
                    const ref = a.evidence_basis_ref;
                    if (!isObject(ref) ||
                        Object.keys(ref).sort().join(",") !== "evidence_basis_hash,evidence_basis_id" ||
                        !/^[0-9a-f]{64}$/.test(String(ref["evidence_basis_id"])) ||
                        !/^[0-9a-f]{64}$/.test(String(ref["evidence_basis_hash"]))) {
                        errors.push("model_advisories[].evidence_basis_ref must contain exact lowercase id/hash");
                    }
                    else {
                        const ePair = `${ref["evidence_basis_id"]}:${ref["evidence_basis_hash"]}`;
                        if (seenE.has(ePair))
                            errors.push("model_advisories[] contains a shared evidence basis ref");
                        seenE.add(ePair);
                        if (ref["evidence_basis_id"] === a.model_position_id ||
                            ref["evidence_basis_id"] === a.position_hash ||
                            ref["evidence_basis_hash"] === a.model_position_id ||
                            ref["evidence_basis_hash"] === a.position_hash) {
                            errors.push("model_advisories[].evidence_basis_ref is type-confused with O");
                        }
                    }
                }
            }
            // Coherence: advisory carriage implies a re-opened gate (cycle >= 1), and
            // a cycle-0 gate never carries advisories.
            if (advs.length > 0 && (payload.gate_cycle === undefined || payload.gate_cycle === 0)) {
                errors.push("model_advisories present requires gate_cycle >= 1");
            }
        }
    }
    if (payload.gate_cycle !== undefined &&
        payload.gate_cycle > 0 &&
        (payload.model_advisories === undefined || payload.model_advisories.length === 0)) {
        errors.push("gate_cycle >= 1 requires at least one model_advisories entry");
    }
    const sw = payload.system_will;
    if (!sw || typeof sw !== "object") {
        errors.push("system_will is required");
    }
    else {
        if (!isNonEmptyString(sw.summary)) {
            errors.push("system_will.summary must be a non-empty string");
        }
        if (!ACTION_TYPES.includes(sw.action_type)) {
            errors.push(`system_will.action_type must be one of ${ACTION_TYPES.join(" | ")}`);
        }
        if (sw.affected_resources !== undefined) {
            if (sw.affected_resources.length > PENDING_AFFECTED_RESOURCES_LIMIT) {
                errors.push(`system_will.affected_resources exceeds the cap of ${PENDING_AFFECTED_RESOURCES_LIMIT}`);
            }
            for (const r of sw.affected_resources) {
                if (!isNonEmptyString(r.path)) {
                    errors.push("system_will.affected_resources[].path must be a non-empty string");
                }
                if (!CHANGE_TYPES.includes(r.change_type)) {
                    errors.push(`system_will.affected_resources[].change_type must be one of ${CHANGE_TYPES.join(" | ")}`);
                }
            }
            // Truncation flags must be self-consistent when resources are present.
            if (sw.affected_resources_truncated === true &&
                sw.affected_resources.length < PENDING_AFFECTED_RESOURCES_LIMIT) {
                errors.push("system_will.affected_resources_truncated is true but the list is below the cap");
            }
            if (typeof sw.affected_resources_total === "number" &&
                sw.affected_resources_total < sw.affected_resources.length) {
                errors.push("system_will.affected_resources_total is less than the carried list length");
            }
        }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
//# sourceMappingURL=payload.js.map