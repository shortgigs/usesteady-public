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
import {
  type LoadedSkillRegistry,
  type Skill,
  type SkillOutput,
  type SkillOutputSchema,
  type TriggerReason,
} from './types.js';

// ---------------------------------------------------------------------------
// Model adapter interface
// ---------------------------------------------------------------------------

/**
 * The only abstraction point over output production in the Skills v1 layer.
 *
 * An adapter receives a fully loaded Skill (metadata + body instructions) and
 * the raw user input, then produces the skill's typed output or null.
 *
 * Contract:
 *   - Return a SkillOutput whose `schema` field matches skill.metadata.output_schema.
 *   - Return null to signal "this skill has nothing to contribute for this input"
 *     without constituting a failure (distinct from an empty candidates/steps/suggestions
 *     array, which signals "the skill ran and found nothing applicable").
 *   - May throw — the invocation helper wraps all adapter errors as rejections.
 *   - Must NOT execute filesystem operations, approve anything, or call UseSteady core.
 *
 * In production this wraps an LLM call. In tests it is a controlled stub.
 */
export interface SkillModelAdapter {
  invoke(skill: Skill, rawInput: string): Promise<SkillOutput | null>;
}

// ---------------------------------------------------------------------------
// Per-invocation result — the provenance record
// ---------------------------------------------------------------------------

/**
 * The result of invoking one Skill via an adapter.
 *
 * Every field except `rejectionReason` is always present.
 * `rejectionReason` is physically absent (not undefined) when the invocation
 * was accepted — required by exactOptionalPropertyTypes: true.
 *
 * This shape carries enough information for the audit logger (file 7) to
 * produce a SkillAuditRecord without re-querying the registry.
 */
export interface SkillInvocationResult {
  readonly skillName: string;
  readonly skillVersion: string;
  readonly outputSchema: SkillOutputSchema;
  /**
   * The raw output returned by the adapter, or null if:
   *   - the adapter returned null (declined to contribute), or
   *   - the adapter threw an error.
   * Even when rejected due to schema mismatch, the raw output is preserved
   * here so the audit log captures what the adapter actually returned.
   */
  readonly rawOutput: SkillOutput | null;
  readonly validationOutcome: 'accepted' | 'rejected';
  /** Absent when accepted; present (as a string, not undefined) when rejected. */
  readonly rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// Aggregate result
// ---------------------------------------------------------------------------

/**
 * The result of invoking all triggerable skills for a given trigger context.
 *
 * `results` is the full list including rejections — callers and the audit
 * logger should use this for complete provenance.
 *
 * `accepted` is a convenience slice: only the non-null outputs from skills
 * whose validationOutcome === 'accepted'. Callers presenting output to the
 * user should iterate this list, not `results`.
 */
export interface InvokeSkillsResult {
  readonly triggerReason: TriggerReason;
  readonly rawInput: string;
  /** All invocation results in priority order. May include rejections. */
  readonly results: readonly SkillInvocationResult[];
  /** Accepted, non-null outputs in priority order. May be empty. */
  readonly accepted: readonly SkillOutput[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface InvokeSkillsOptions {
  readonly registry: LoadedSkillRegistry;
  readonly triggerReason: TriggerReason;
  /**
   * The raw user input string, passed unchanged to each adapter invocation.
   * Also stored in InvokeSkillsResult for provenance.
   */
  readonly rawInput: string;
  readonly adapter: SkillModelAdapter;
}

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
function validateAdapterOutput(
  skill: Skill,
  output: SkillOutput,
): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
  if (output.schema !== skill.metadata.output_schema) {
    return {
      valid:  false,
      reason:
        `Adapter returned schema "${output.schema}" ` +
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
async function invokeOneSkill(
  skill: Skill,
  rawInput: string,
  adapter: SkillModelAdapter,
): Promise<SkillInvocationResult> {
  // Provenance fields that are always present, regardless of outcome.
  const provenance = {
    skillName:    skill.metadata.name,
    skillVersion: skill.metadata.version,
    outputSchema: skill.metadata.output_schema,
  } as const;

  // ── Adapter call — isolated, any throw becomes a rejection ────────────────
  let output: SkillOutput | null;
  try {
    output = await adapter.invoke(skill, rawInput);
  } catch (err) {
    return {
      ...provenance,
      rawOutput:         null,
      validationOutcome: 'rejected',
      rejectionReason:
        `Adapter threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── null return — skill declined to contribute ────────────────────────────
  if (output === null) {
    return {
      ...provenance,
      rawOutput:         null,
      validationOutcome: 'rejected',
      rejectionReason:   'Adapter returned null — skill has nothing to contribute for this input.',
    };
  }

  // ── Schema validation ─────────────────────────────────────────────────────
  const check = validateAdapterOutput(skill, output);
  if (!check.valid) {
    return {
      ...provenance,
      // Preserve raw output even on rejection so audit logs capture what
      // the adapter actually returned, not just that it failed.
      rawOutput:         output,
      validationOutcome: 'rejected',
      rejectionReason:   check.reason,
    };
  }

  // ── Accepted — rejectionReason is absent (not set to undefined) ───────────
  return {
    ...provenance,
    rawOutput:         output,
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
export async function invokeSkillsForTrigger(
  options: InvokeSkillsOptions,
): Promise<InvokeSkillsResult> {
  const { registry, triggerReason, rawInput, adapter } = options;

  // Retrieve the skills eligible for this trigger context.
  // No cross-kind fallback — if this list is empty, accepted will be empty.
  const skills = getTriggerableSkills(registry, triggerReason);

  // Invoke each skill independently and concurrently.
  // Skills are already in priority order; Promise.all preserves that order.
  const results = await Promise.all(
    skills.map((skill) => invokeOneSkill(skill, rawInput, adapter)),
  );

  // Extract accepted outputs for caller convenience.
  // The type predicate narrows rawOutput from SkillOutput | null to SkillOutput
  // so the .map below can safely return SkillOutput (not SkillOutput | null).
  const accepted = results
    .filter(
      (r): r is SkillInvocationResult & { readonly rawOutput: SkillOutput } =>
        r.validationOutcome === 'accepted' && r.rawOutput !== null,
    )
    .map((r) => r.rawOutput);

  return { triggerReason, rawInput, results, accepted };
}
