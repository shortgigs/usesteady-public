/**
 * RoutingSurface — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Trust Surface Model, Phase 3A).
 *
 * The pre-execution routing outcome as a typed, plain, serializable engine
 * object. It answers ONE question: "What is the truthful way to present this
 * request before execution?"
 *
 * Binding invariants (see docs/product/USESTEADY_ROUTING_SURFACE_DESIGN_V1.md):
 *   1. Zero authority. A RoutingSurface describes; it never decides. The shape
 *      `if (surface.type === "system_will") execute()` is forbidden. Authority
 *      stays where frozen: Safety, Approval, Decision Basis, Execution gate.
 *   2. Serializable + replayable. Every variant is plain JSON — no closures,
 *      class instances, or renderer objects. `isSerializableSurface(s)` must hold.
 *   3. Additive migration. Carried additively on RunResponse; ShellFrame and
 *      existing RunResponse fields stay behavior-identical and are DERIVED from
 *      the surface (Phase 3B/3C). No frozen contract breaks.
 *   4. Not a constitutional object. Lives in src/workflow/, beside WorkflowSpec
 *      and ClarifyCommitment. NEVER in src/constitution/.
 *
 * This is NOT the post-execution "Trust Surface" in src/executor/observability/.
 * That answers "what actually happened after execution"; this answers "how to
 * truthfully present this request before execution". The umbrella name is the
 * "Trust Surface Model"; this concrete engine type is `RoutingSurface`.
 */
// ─── Constructors (normalize to plain, serializable values) ──────────────────
/**
 * Drop `undefined`-valued keys so optional fields round-trip through JSON
 * cleanly (JSON.stringify omits them; an explicit `key: undefined` would break
 * structural equality after a round-trip). Used by constructors that carry
 * optional fields.
 */
function omitUndefined(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
export function willSurface(args) {
    return omitUndefined({
        type: "system_will",
        operation: args.operation,
        headline: args.headline,
        preview: args.preview,
    });
}
export function suggestSurface(suggestions) {
    return { type: "system_suggests", suggestions };
}
export function reflectionSurface(args) {
    return { type: "reflection", ...args };
}
export function clarifySurface(clarify) {
    return { type: "clarify", clarify };
}
export function workPlanSurface(workPlan) {
    return { type: "work_plan", workPlan };
}
export function safetySurface(args) {
    return omitUndefined({
        type: "safety",
        reason: args.reason,
        note: args.note,
        blockedInput: args.blockedInput,
        matchedPattern: args.matchedPattern,
        detectorId: args.detectorId,
    });
}
// ─── Serializability + replay (Invariant 2) ──────────────────────────────────
/**
 * Structural-equality check after a JSON round-trip. A RoutingSurface is valid
 * iff it survives `JSON.parse(JSON.stringify(s))` unchanged. This is the
 * machine-checkable form of Invariant 2 (serializable + replayable).
 */
export function isSerializableSurface(surface) {
    let json;
    try {
        json = JSON.stringify(surface);
    }
    catch {
        return false;
    }
    return deepEqual(surface, JSON.parse(json));
}
/** Parse a previously-serialized RoutingSurface for replay/certification. */
export function parseRoutingSurface(json) {
    return JSON.parse(json);
}
function deepEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a !== typeof b)
        return false;
    if (a === null || b === null)
        return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b))
            return false;
        if (a.length !== b.length)
            return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
        const ao = a;
        const bo = b;
        const ak = Object.keys(ao);
        const bk = Object.keys(bo);
        if (ak.length !== bk.length)
            return false;
        return ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
    }
    return false;
}
//# sourceMappingURL=routing-surface.js.map