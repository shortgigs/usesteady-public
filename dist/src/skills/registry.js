/**
 * UseSteady Skills v1 — registry (file 5 of 8).
 *
 * The public query API over a LoadedSkillRegistry.
 *
 * Everything here is read-only, synchronous, and has no side effects.
 * The registry functions:
 *   - surface which skills are eligible for a given trigger context
 *   - encode the deterministic-first boundary in the function signatures
 *   - return skills in the pre-sorted order established by buildRegistry
 *   - never re-sort, never merge outputs, never interpret or decide intent
 *
 * Authority boundary (enforced structurally, not by convention):
 *   The registry can tell callers WHICH skills are eligible.
 *   It cannot and does not: validate execution, choose final intent,
 *   merge candidate outputs, decide approval, or evaluate policy.
 */
// ---------------------------------------------------------------------------
// Kind-based lookup
// ---------------------------------------------------------------------------
/**
 * Return all loaded skills of the given kind in their pre-sorted order
 * (ascending priority, then source path as a stable tie-break).
 *
 * Implementation note — exhaustive switch over direct property access:
 * `registry.byKind[kind]` where `kind: SkillKind` could be treated as an
 * index-signature access by the TypeScript compiler under noUncheckedIndexedAccess,
 * returning `readonly Skill[] | undefined`. The switch eliminates the variable
 * key form entirely: each arm uses a specific known property (.interpretation,
 * .workflow_generation, .recovery) whose type is unambiguously `readonly Skill[]`.
 */
export function getSkillsByKind(registry, kind) {
    switch (kind) {
        case 'interpretation': return registry.byKind.interpretation;
        case 'workflow_generation': return registry.byKind.workflow_generation;
        case 'recovery': return registry.byKind.recovery;
    }
}
// ---------------------------------------------------------------------------
// Deterministic-first boundary
// ---------------------------------------------------------------------------
/**
 * Return the skills eligible to be consulted for the given trigger context,
 * in priority-ascending order.
 *
 * The boundary is encoded in the signature, not left to caller convention:
 *
 *   TriggerReason.kind = 'interpretation'
 *     → interpretation skills only
 *     → only reaches this path after the deterministic parser returned null
 *
 *   TriggerReason.kind = 'workflow_generation'
 *     → workflow_generation skills only
 *     → only reaches this path on explicit broad/multi-step requests
 *
 *   TriggerReason.kind = 'recovery'
 *     → recovery skills only
 *     → only reaches this path after unsupported / blocked / failed outcomes
 *
 * A caller cannot ask for workflow_generation skills via an interpretation
 * TriggerReason — they are different types. Cross-kind consultation requires
 * constructing a second, explicitly typed TriggerReason.
 *
 * Returns the already-sorted slice from the registry. Callers MUST NOT
 * re-sort the result — the established evaluation order is part of the contract.
 */
export function getTriggerableSkills(registry, triggerReason) {
    // Route directly from the trigger's kind to the matching bucket.
    // No additional filtering here — the caller chose the trigger context;
    // the registry's only job is to return the right pre-sorted set.
    return getSkillsByKind(registry, triggerReason.kind);
}
/**
 * Guard helper: answers "are any skills of the needed kind loaded?"
 *
 * Callers should call this BEFORE constructing the trigger context and
 * preparing to invoke skills, to short-circuit the overhead when no
 * skills of the needed kind are installed.
 *
 * This function does NOT answer "would a suggestion actually help?" or
 * "is the input plausibly actionable?" — those are caller-side judgements
 * that require runtime context the registry does not and should not have.
 * This function only checks presence: length > 0.
 */
export function shouldConsultSkills(registry, triggerReason) {
    return getSkillsByKind(registry, triggerReason.kind).length > 0;
}
// ---------------------------------------------------------------------------
// Ordering guarantee (documented, not enforced by runtime — callers must read)
// ---------------------------------------------------------------------------
/**
 * The ordering of skills returned by getSkillsByKind and getTriggerableSkills
 * is determined once by buildRegistry and must not be altered by callers.
 *
 * Order within each kind:
 *   1. Ascending `priority` (lower number = evaluated first)
 *   2. Source path, locale-insensitive alphabetical (stable tie-break)
 *
 * Skills with default priority (100) are sorted purely by path.
 * A skill with priority 50 is always evaluated before one with priority 100.
 *
 * This object is provided for documentation and test reference — not as a
 * runtime sort function (sorting happens in buildRegistry, not here).
 */
export const ORDERING_CONTRACT = {
    primary: 'priority ascending',
    tieBreaker: 'source path alphabetical',
    setBy: 'buildRegistry',
    mutableBy: 'never — re-sorting the result is a contract violation',
};
/**
 * Return a lightweight stats snapshot of the registry.
 *
 * Intended for: startup logging, health checks, audit record metadata,
 * and test assertions about the loaded state.
 */
export function getRegistryStats(registry) {
    return {
        total: registry.all.length,
        byKind: {
            interpretation: registry.byKind.interpretation.length,
            workflow_generation: registry.byKind.workflow_generation.length,
            recovery: registry.byKind.recovery.length,
        },
        loadedAt: registry.loadedAt,
        hasAnySkills: registry.all.length > 0,
    };
}
export function getSkillSummaries(registry) {
    function toSummary(skill) {
        return {
            name: skill.metadata.name,
            version: skill.metadata.version,
            priority: skill.metadata.priority,
            sourcePath: skill.sourcePath,
        };
    }
    return {
        interpretation: registry.byKind.interpretation.map(toSummary),
        workflow_generation: registry.byKind.workflow_generation.map(toSummary),
        recovery: registry.byKind.recovery.map(toSummary),
    };
}
//# sourceMappingURL=registry.js.map