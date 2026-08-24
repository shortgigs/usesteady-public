/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - pure parser +
 * interpreter for the Portal -> Core decision poll.
 *
 * Direction: Portal -> Core, returned by
 * `GET /api/v1/pending-approvals/decisions?run_id=...`, which Core polls while a
 * gate is open. This module owns the frozen `ucp.approval_decision.v1` read side
 * and is PURE: no network, no clock-dependence beyond a caller-supplied "now" is
 * needed (none is - the Portal already resolves TTL/expiry server-side), no
 * filesystem, no env. The poll loop and the gate enforcement are later PRs.
 *
 * Authority (the crux): a polled `approved` is a remote APPROVAL INPUT, not an
 * execution command. `interpretDecision` returns a DIRECTIVE describing what Core
 * should do; it never executes. On `approved` the directive is `approved`, and
 * the caller MUST still re-validate eligibility at Core's own gate before running
 * the step (INV-LA-AUTH2). Silence/absence is never approval - it maps to `wait`,
 * and the poll-loop's own wait-bound (a later PR) degrades to local approval, not
 * to silent execution (INV-LA-AUTH3).
 *
 * Frozen wire contract: PENDING_APPROVAL_BRIDGE_V1
 * (docs/product/pending-approval-bridge-contract-v1.md, authored in usesteady-ops).
 */
/** Frozen schema discriminator. Literal type - any other value is a bug. */
export const APPROVAL_DECISION_SCHEMA = "ucp.approval_decision.v1";
const STATUSES = [
    "pending",
    "approved",
    "rejected",
    "expired",
    "withdrawn",
];
const VERBS = ["approve", "reject"];
function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
}
function isNonNegativeInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
function isStringOrNull(v) {
    return v === null || typeof v === "string";
}
/**
 * Fail-closed parse of an untrusted poll response body. Returns `ok: false` with
 * reasons for anything malformed - the poll loop treats a parse failure like an
 * unreachable Portal (eventually falling back to local approval, never approving).
 * Unknown fields are ignored (forward-compatible, additive-evolution contract).
 */
export function parseApprovalDecisionResponse(body) {
    const errors = [];
    if (!isObject(body)) {
        return { ok: false, errors: ["response must be a JSON object"] };
    }
    if (body["schema"] !== APPROVAL_DECISION_SCHEMA) {
        errors.push(`schema must be the literal "${APPROVAL_DECISION_SCHEMA}"`);
    }
    if (!isNonEmptyString(body["run_id"])) {
        errors.push("run_id must be a non-empty string");
    }
    const rawDecisions = body["decisions"];
    const entries = [];
    if (!Array.isArray(rawDecisions)) {
        errors.push("decisions must be an array");
    }
    else {
        for (const raw of rawDecisions) {
            if (!isObject(raw)) {
                errors.push("each decisions entry must be an object");
                break;
            }
            if (!isNonNegativeInt(raw["step_index"])) {
                errors.push("decisions[].step_index must be a non-negative integer");
                break;
            }
            if (!STATUSES.includes(raw["status"])) {
                errors.push("decisions[].status must be one of pending|approved|rejected|expired|withdrawn");
                break;
            }
            const decisionRaw = raw["decision"];
            if (decisionRaw !== null &&
                decisionRaw !== undefined &&
                !VERBS.includes(decisionRaw)) {
                errors.push("decisions[].decision must be approve|reject|null");
                break;
            }
            if (raw["decided_at"] !== undefined && !isStringOrNull(raw["decided_at"])) {
                errors.push("decisions[].decided_at must be a string or null");
                break;
            }
            if (raw["decided_by"] !== undefined && !isStringOrNull(raw["decided_by"])) {
                errors.push("decisions[].decided_by must be a string or null");
                break;
            }
            if (raw["id"] !== undefined && !isStringOrNull(raw["id"])) {
                errors.push("decisions[].id must be a string or null");
                break;
            }
            if (raw["gate_cycle"] !== undefined && !isNonNegativeInt(raw["gate_cycle"])) {
                errors.push("decisions[].gate_cycle must be a non-negative integer");
                break;
            }
            if (raw["decision_relation"] !== undefined &&
                !isStringOrNull(raw["decision_relation"])) {
                errors.push("decisions[].decision_relation must be a string or null");
                break;
            }
            entries.push({
                step_index: raw["step_index"],
                status: raw["status"],
                decision: decisionRaw === null || decisionRaw === undefined
                    ? null
                    : decisionRaw,
                decided_at: raw["decided_at"] === undefined ? null : raw["decided_at"],
                decided_by: raw["decided_by"] === undefined ? null : raw["decided_by"],
                ...(raw["id"] !== undefined && raw["id"] !== null
                    ? { id: raw["id"] }
                    : {}),
                ...(raw["authority_assertion"] !== undefined
                    ? { authority_assertion: raw["authority_assertion"] }
                    : {}),
                ...(raw["gate_cycle"] !== undefined && raw["gate_cycle"] !== null
                    ? { gate_cycle: raw["gate_cycle"] }
                    : {}),
                ...(raw["decision_relation"] !== undefined
                    ? { decision_relation: raw["decision_relation"] }
                    : {}),
                ...(Array.isArray(raw["resolving_evidence_ids"])
                    ? { resolving_evidence_ids: raw["resolving_evidence_ids"] }
                    : {}),
                ...(Array.isArray(raw["retirement_basis_relations"])
                    ? {
                        retirement_basis_relations: raw["retirement_basis_relations"],
                    }
                    : {}),
            });
        }
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return {
        ok: true,
        value: {
            schema: APPROVAL_DECISION_SCHEMA,
            run_id: body["run_id"].trim(),
            decisions: entries,
        },
    };
}
/**
 * Find the gate entry for a given 0-based step index, or null when the run's
 * decision list does not (yet) include it. A missing entry is "not decided yet",
 * which `interpretDecision` maps to `wait` (never to approval).
 *
 * When multiple entries exist for one step (P3 gate cycles), this returns the
 * entry with the HIGHEST gate_cycle — the latest gate emission is the one whose
 * decision the caller needs. Legacy (single-entry) runs are unaffected.
 */
export function selectDecisionForStep(response, stepIndex) {
    let best = null;
    for (const d of response.decisions) {
        if (d.step_index !== stepIndex)
            continue;
        if (best === null || (d.gate_cycle ?? 0) > (best.gate_cycle ?? 0))
            best = d;
    }
    return best;
}
/**
 * P3 Phase 2: select the entry for EXACTLY one gate emission cycle. A parked
 * advisory gate polls for the cycle-N entry only — the prior cycle-0 entry
 * (already decided when the advisory episode began) must never satisfy it.
 */
export function selectDecisionForStepAndCycle(response, stepIndex, gateCycle) {
    return (response.decisions.find((d) => d.step_index === stepIndex && (d.gate_cycle ?? 0) === gateCycle) ?? null);
}
/**
 * Map a polled status to Core's directive. Pure and total over the status enum.
 */
export function interpretDecisionStatus(status) {
    switch (status) {
        case "pending":
            return { kind: "wait" };
        case "approved":
            return { kind: "approved" };
        case "rejected":
            return { kind: "rejected" };
        case "expired":
            return { kind: "fallback_local", reason: "expired" };
        case "withdrawn":
            return { kind: "withdrawn" };
    }
}
/**
 * Interpret a single gate entry (or its absence) into Core's directive. A null
 * entry (the gate is not in the polled list yet) is `wait` - never approval
 * (fail-closed, INV-LA-AUTH3).
 */
export function interpretDecision(entry) {
    if (!entry)
        return { kind: "wait" };
    return interpretDecisionStatus(entry.status);
}
//# sourceMappingURL=decision.js.map