/**
 * UseSteady Skills v1 — invocation helper (file 6 of 8).
 *
 * This file is the boundary between the registry and anything that actually
 * produces skill output. It is the most sensitive module in the system.
 *
 * What this file owns:
 *   - The SkillModelAdapter interface (the only abstraction over output production)
 *   - Per-skill invocation with full error isolation
 *   - Output schema validation (adapter output must match the skill's declared schema)
 *   - Per-invocation provenance (name, version, schema, raw output, outcome)
 *   - The aggregate InvokeSkillsResult shape the caller receives
 *
 * What this file explicitly does NOT own:
 *   - Deciding whether the deterministic parser was right (caller's responsibility)
 *   - Deciding whether input is "plausibly actionable" (caller's responsibility)
 *   - Deciding policy or approval (never, anywhere in the Skills layer)
 *   - Merging skill output into canonical execution state (UseSteady core's job)
 *   - Auto-fallback across kinds (there is no fallback here)
 *   - Choosing a different trigger kind than what the caller provided
 *
 * Deterministic-first boundary:
 *   Callers decide to invoke skills — this file does not. A caller invokes
 *   this helper only after the deterministic parser has run and its result
 *   made a trigger decision. The TriggerReason parameter carries that decision
 *   forward so it is preserved in every provenance record.
 */
import { getTriggerableSkills } from './registry.js';
// ---------------------------------------------------------------------------
// Internal — output schema validation
// ---------------------------------------------------------------------------
/**
 * Validate that the adapter's output schema matches the skill's declared schema.
 *
 * This is the only structural check the invocation helper performs.
 * Full candidate/step/suggestion validation is the responsibility of the
 * consumer (UseSteady's validation layer), not this boundary helper.
 *
 * The check compares `output.schema` against `skill.metadata.output_schema`.
 * `skill.metadata.output_schema` was verified against KIND_SCHEMA_MAP at
 * load time, so this check transitively enforces the kind→schema mapping.
 */
function validateAdapterOutput(skill, output) {
    if (output.schema !== skill.metadata.output_schema) {
        return {
            valid: false,
            reason: `Adapter returned schema "${output.schema}" ` +
                `but skill "${skill.metadata.name}" declared "${skill.metadata.output_schema}". ` +
                `Output is rejected; raw output preserved in provenance record.`,
        };
    }
    return { valid: true };
}
// ---------------------------------------------------------------------------
// Internal — single-skill invocation
// ---------------------------------------------------------------------------
/**
 * Invoke one Skill via the adapter and return a provenance record.
 *
 * Failure modes and their outcomes:
 *   Adapter throws       → rejected, rawOutput: null, rejectionReason: error message
 *   Adapter returns null → rejected, rawOutput: null, rejectionReason: "declined"
 *   Schema mismatch      → rejected, rawOutput: <raw> (preserved for audit)
 *   Schema matches       → accepted, rawOutput: <output>
 *
 * exactOptionalPropertyTypes compliance:
 *   `rejectionReason` is included only in rejected branches.
 *   Accepted results omit the field entirely (not set to undefined).
 */
async function invokeOneSkill(skill, rawInput, adapter) {
    // Provenance fields that are always present, regardless of outcome.
    const provenance = {
        skillName: skill.metadata.name,
        skillVersion: skill.metadata.version,
        outputSchema: skill.metadata.output_schema,
    };
    // ── Adapter call — isolated, any throw becomes a rejection ────────────────
    let output;
    try {
        output = await adapter.invoke(skill, rawInput);
    }
    catch (err) {
        return {
            ...provenance,
            rawOutput: null,
            validationOutcome: 'rejected',
            rejectionReason: `Adapter threw: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    // ── null return — skill declined to contribute ────────────────────────────
    if (output === null) {
        return {
            ...provenance,
            rawOutput: null,
            validationOutcome: 'rejected',
            rejectionReason: 'Adapter returned null — skill has nothing to contribute for this input.',
        };
    }
    // ── Schema validation ─────────────────────────────────────────────────────
    const check = validateAdapterOutput(skill, output);
    if (!check.valid) {
        return {
            ...provenance,
            // Preserve raw output even on rejection so audit logs capture what
            // the adapter actually returned, not just that it failed.
            rawOutput: output,
            validationOutcome: 'rejected',
            rejectionReason: check.reason,
        };
    }
    // ── Accepted — rejectionReason is absent (not set to undefined) ───────────
    return {
        ...provenance,
        rawOutput: output,
        validationOutcome: 'accepted',
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Invoke all triggerable skills for a given trigger context and return their
 * results with full provenance.
 *
 * Deterministic-first enforcement:
 *   This function does not decide when to consult skills. The caller has
 *   already made that decision by constructing a TriggerReason. This function
 *   executes the decision — no more, no less.
 *
 * No auto-fallback:
 *   If no skills are loaded for the trigger kind, or if all invocations are
 *   rejected, the returned `accepted` array is empty. The caller decides what
 *   to do with an empty result — this function does not try another kind.
 *
 * Ordering:
 *   Skills are already in priority order from the registry (buildRegistry).
 *   Results preserve that order. Promise.all runs adapter calls concurrently
 *   but preserves input order in the output array.
 *
 * Isolation:
 *   Each skill is invoked independently. An adapter error for one skill
 *   becomes a rejection for that skill; other skills continue to run.
 *
 * @param options.registry      The loaded skill registry.
 * @param options.triggerReason The trigger context — drives which skill kind is consulted.
 * @param options.rawInput      The raw user input, passed unchanged to each adapter.
 * @param options.adapter       The model adapter that produces skill output.
 */
export async function invokeSkillsForTrigger(options) {
    const { registry, triggerReason, rawInput, adapter } = options;
    // Retrieve the skills eligible for this trigger context.
    // No cross-kind fallback — if this list is empty, accepted will be empty.
    const skills = getTriggerableSkills(registry, triggerReason);
    // Invoke each skill independently and concurrently.
    // Skills are already in priority order; Promise.all preserves that order.
    const results = await Promise.all(skills.map((skill) => invokeOneSkill(skill, rawInput, adapter)));
    // Extract accepted outputs for caller convenience.
    // The type predicate narrows rawOutput from SkillOutput | null to SkillOutput
    // so the .map below can safely return SkillOutput (not SkillOutput | null).
    const accepted = results
        .filter((r) => r.validationOutcome === 'accepted' && r.rawOutput !== null)
        .map((r) => r.rawOutput);
    return { triggerReason, rawInput, results, accepted };
}
//# sourceMappingURL=invocation.js.map