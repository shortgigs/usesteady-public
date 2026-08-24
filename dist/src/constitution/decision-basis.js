/**
 * Constitution Materialization V1 — Decision Basis assembly.
 *
 * Implements USESTEADY_CONSTITUTION_V1 Article I (the Decision Basis) at the
 * smallest possible scope: assemble a Decision Basis from the final
 * WorkflowSpec.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 *
 *   The Constitution defines the Decision Basis as the closed set of facts a
 *   decision depends on, organized into EIGHT classes (Article I):
 *
 *     1. Proposal
 *     2. Repository
 *     3. Configuration
 *     4. Policies
 *     5. Dependencies
 *     6. Environment
 *     7. Principal Authority
 *     8. Retrieved Evidence Used
 *
 *   Phase 1 derives the basis from a WorkflowSpec alone. A WorkflowSpec carries
 *   only some of these classes (Proposal fully; Configuration and Policies
 *   partially). The remaining classes are present as explicit `null` slots —
 *   not omitted — so the basis shape is the full eight from day one and future
 *   phases populate the null slots (Repository SHA, Dependencies, Environment,
 *   Principal Authority, Retrieved Evidence) without changing the schema.
 *
 * ── Determinism contract (mirrors src/workflow/spec-hash.ts) ──────────────────
 *
 *   - Field order is fixed by this module, not by object construction order.
 *   - Optional fields normalize to `null` so {} and {x: undefined} are identical.
 *   - Readonly arrays are spread to plain arrays for stable serialization.
 *   - Pure: no I/O, no side effects. (Persistence lives in approval-record.ts.)
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   - NOT a verifier (Article V) — it only assembles the basis the verifier and
 *     the fingerprint read.
 *   - NOT authority — assembling a basis grants nothing; approval is unchanged.
 *   - NOT a redesign of WorkflowSpec — it projects the spec, never mutates it.
 */
// ─── Assembly ─────────────────────────────────────────────────────────────────
function canonicalTaskFact(task) {
    return {
        input: task.input,
        runtime: task.runtime ?? null,
        operationType: task.operationType ?? null,
        targetFiles: task.targetFiles ? [...task.targetFiles] : null,
        content: task.content ?? null,
        newPath: task.newPath ?? null,
        command: task.command ?? null,
        structuredReplace: task.structuredReplace
            ? {
                oldValue: task.structuredReplace.oldValue,
                newValue: task.structuredReplace.newValue,
                filePath: task.structuredReplace.filePath,
            }
            : null,
    };
}
function normalizeRepository(r) {
    if (!r)
        return null;
    return { identity: r.identity ?? null, commit: r.commit ?? null, dirty: r.dirty ?? null };
}
/**
 * Assemble a Decision Basis from the final WorkflowSpec and any injected
 * non-spec facts.
 *
 * Pure projection. The same spec content and the same facts always produce the
 * same basis, independent of object key insertion order. Called with no facts
 * (or all-null facts) it is identical to the Phase-1 spec-only basis.
 *
 * @param spec   The approved WorkflowSpec (the Proposal).
 * @param facts  Optional non-spec facts (e.g. captured Repository provenance).
 * @returns      The eight-class Decision Basis.
 */
export function assembleDecisionBasis(spec, facts) {
    return {
        proposal: {
            name: spec.name,
            tasks: spec.tasks.map(canonicalTaskFact),
        },
        repository: normalizeRepository(facts?.repository),
        configuration: {
            defaultRuntime: spec.defaultRuntime ?? null,
            maxRetries: spec.maxRetries ?? null,
        },
        policies: {
            ocdAdditionalProhibitedGlobs: spec.ocdOverride
                ? [...spec.ocdOverride.additionalProhibitedGlobs]
                : null,
        },
        dependencies: null,
        environment: null,
        principalAuthority: null,
        retrievedEvidenceUsed: null,
    };
}
//# sourceMappingURL=decision-basis.js.map