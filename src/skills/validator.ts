/**
 * UseSteady Skills v1 — validator (file 3 of 8).
 *
 * Single responsibility: given the raw output of parseSkillFile, enforce every
 * constraint from the frozen UseSteady Skills Architecture v1 spec.
 *
 * Design rules followed here:
 *   - Collect ALL issues before returning (never fail-fast on the first error)
 *   - Return a discriminated SkillValidationResult — never throw
 *   - Use SkillValidationIssue.type literals so tests can assert on exact reasons
 *   - Apply guardrails as strict equality checks against boolean literals
 *   - Enforce the kind→schema mapping from KIND_SCHEMA_MAP (single source of truth)
 *   - Treat absent optional fields (risk_level, priority) correctly under
 *     exactOptionalPropertyTypes: true
 */

import {
  KIND_SCHEMA_MAP,
  REQUIRED_BODY_SECTIONS,
  type RequiredBodySection,
  type SkillKind,
  type SkillMetadata,
  type SkillOutputSchema,
  type SkillValidationIssue,
  type SkillValidationResult,
} from './types.js';
import type { ParsedSkillFile } from './parser.js';

// ---------------------------------------------------------------------------
// Type guards — each is a precise predicate, no Set or cast required
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isSkillKind(v: unknown): v is SkillKind {
  return (
    v === 'interpretation' ||
    v === 'workflow_generation' ||
    v === 'recovery'
  );
}

function isSkillOutputSchema(v: unknown): v is SkillOutputSchema {
  return (
    v === 'usesteady.intent_candidates.v1' ||
    v === 'usesteady.workflow_draft.v1' ||
    v === 'usesteady.recovery_suggestions.v1'
  );
}

/**
 * Minimal semver check: requires at least major.minor.patch digits.
 * Pre-release and build-metadata suffixes are allowed (not validated).
 */
function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v);
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

// ---------------------------------------------------------------------------
// Per-field validators
// Each function pushes zero or more SkillValidationIssue objects into `issues`.
// None of them return early from validateSkill — full aggregation is the goal.
// ---------------------------------------------------------------------------

function checkRequiredString(
  fm: Record<string, unknown>,
  field: string,
  issues: SkillValidationIssue[],
): void {
  const value = fm[field];
  if (value === undefined || value === null) {
    issues.push({
      type: 'missing_field',
      field,
      message: `Required field "${field}" is absent.`,
    });
  } else if (!isNonEmptyString(value)) {
    issues.push({
      type: 'invalid_field',
      field,
      message: `Field "${field}" must be a non-empty string; got ${JSON.stringify(value)}.`,
    });
  }
}

function checkVersion(
  fm: Record<string, unknown>,
  issues: SkillValidationIssue[],
): void {
  const value = fm['version'];
  if (value === undefined || value === null) {
    issues.push({
      type: 'missing_field',
      field: 'version',
      message: 'Required field "version" is absent.',
    });
  } else if (!isValidVersion(value)) {
    issues.push({
      type: 'invalid_field',
      field: 'version',
      message:
        `Field "version" must be a semantic version string (e.g. "1.0.0"); ` +
        `got ${JSON.stringify(value)}.`,
    });
  }
}

/**
 * Check `kind` and return the valid SkillKind value, or null if invalid.
 * Returning the validated kind lets checkOutputSchema enforce the mapping
 * without re-reading the field.
 */
function checkKind(
  fm: Record<string, unknown>,
  issues: SkillValidationIssue[],
): SkillKind | null {
  const value = fm['kind'];
  if (value === undefined || value === null) {
    issues.push({
      type: 'missing_field',
      field: 'kind',
      message: 'Required field "kind" is absent.',
    });
    return null;
  }
  if (!isSkillKind(value)) {
    issues.push({
      type: 'invalid_kind',
      field: 'kind',
      message:
        `Field "kind" must be one of "interpretation", "workflow_generation", ` +
        `"recovery"; got ${JSON.stringify(value)}.`,
    });
    return null;
  }
  return value;
}

/**
 * Check `output_schema` presence, validity, and — when kind is also valid —
 * the kind→schema mapping from KIND_SCHEMA_MAP.
 * Called after checkKind so the kind parameter is already validated (or null).
 */
function checkOutputSchema(
  fm: Record<string, unknown>,
  validatedKind: SkillKind | null,
  issues: SkillValidationIssue[],
): void {
  const value = fm['output_schema'];
  if (value === undefined || value === null) {
    issues.push({
      type: 'missing_field',
      field: 'output_schema',
      message: 'Required field "output_schema" is absent.',
    });
    return;
  }
  if (!isSkillOutputSchema(value)) {
    issues.push({
      type: 'invalid_field',
      field: 'output_schema',
      message:
        `Field "output_schema" must be one of the three supported schema identifiers; ` +
        `got ${JSON.stringify(value)}.`,
    });
    return;
  }
  // Kind→schema mapping — only checked when kind itself is also valid.
  // A missing or invalid kind produces its own issue; conflating the two would
  // create confusing double-error messages.
  if (validatedKind !== null) {
    const expectedSchema = KIND_SCHEMA_MAP[validatedKind];
    if (value !== expectedSchema) {
      issues.push({
        type: 'schema_mismatch',
        field: 'output_schema',
        message:
          `Kind "${validatedKind}" requires output_schema "${expectedSchema}" ` +
          `but got "${value}".`,
      });
    }
  }
}

/**
 * Guardrail checks.
 *
 * Each boolean is compared with strict equality (===) against its required
 * literal value. A missing field is treated as a guardrail_violation (not a
 * missing_field) because intent matters: the spec requires these fields to be
 * present AND set correctly. Absence is as dangerous as a wrong value.
 */
const GUARDRAIL_CHECKS = [
  { field: 'requires_review',    expected: true  } as const,
  { field: 'can_execute',        expected: false } as const,
  { field: 'can_call_tools',     expected: false } as const,
  { field: 'can_bypass_policy',  expected: false } as const,
  { field: 'can_bypass_approval',expected: false } as const,
] as const;

function checkGuardrails(
  fm: Record<string, unknown>,
  issues: SkillValidationIssue[],
): void {
  for (const { field, expected } of GUARDRAIL_CHECKS) {
    const value = fm[field];
    if (value === undefined || value === null) {
      issues.push({
        type: 'guardrail_violation',
        field,
        message:
          `Guardrail "${field}" is absent; ` +
          `it must be present and set to exactly ${JSON.stringify(expected)}.`,
      });
    } else if (value !== expected) {
      issues.push({
        type: 'guardrail_violation',
        field,
        message:
          `Guardrail "${field}" must be exactly ${JSON.stringify(expected)}; ` +
          `got ${JSON.stringify(value)}.`,
      });
    }
  }
}

function checkTriggers(
  fm: Record<string, unknown>,
  issues: SkillValidationIssue[],
): void {
  const value = fm['triggers'];
  if (value === undefined || value === null) {
    issues.push({
      type: 'missing_field',
      field: 'triggers',
      message: 'Required field "triggers" is absent.',
    });
    return;
  }
  if (!isStringArray(value)) {
    issues.push({
      type: 'invalid_field',
      field: 'triggers',
      message:
        `Field "triggers" must be an array of strings; ` +
        `got ${JSON.stringify(value)}.`,
    });
    return;
  }
  if (value.length === 0) {
    issues.push({
      type: 'invalid_field',
      field: 'triggers',
      message: 'Field "triggers" must contain at least one entry.',
    });
    return;
  }
  // Every trigger must be a non-empty, non-whitespace string.
  const blankCount = value.filter((t) => t.trim().length === 0).length;
  if (blankCount > 0) {
    issues.push({
      type: 'invalid_field',
      field: 'triggers',
      message: `Field "triggers" contains ${blankCount} empty or blank entry/entries.`,
    });
  }
}

/**
 * Priority is optional. When present it must be a finite number.
 * Validated priority defaults to 100 in buildMetadata when absent.
 */
function checkPriority(
  fm: Record<string, unknown>,
  issues: SkillValidationIssue[],
): void {
  const value = fm['priority'];
  if (value === undefined || value === null) return; // absent is valid
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({
      type: 'invalid_field',
      field: 'priority',
      message:
        `Field "priority" must be a finite number when present; ` +
        `got ${JSON.stringify(value)}.`,
    });
  }
}

/**
 * Map the human-readable section name (from REQUIRED_BODY_SECTIONS) to the
 * camelCase key used in ParsedSections.
 *
 * The switch is exhaustive over RequiredBodySection — TypeScript verifies that
 * every member of the union is handled and the function always returns.
 */
function sectionNameToKey(
  name: RequiredBodySection,
): keyof ParsedSkillFile['sections'] {
  switch (name) {
    case 'Purpose':         return 'purpose';
    case 'When to use':     return 'whenToUse';
    case 'Output contract': return 'outputContract';
    case 'Guardrails':      return 'guardrails';
    case 'Examples':        return 'examples';
  }
}

/**
 * All five required body sections must be present and non-empty.
 * Absent sections are reported as invalid_markdown (a content contract issue,
 * not a field issue) to make them distinguishable from frontmatter problems in
 * test assertions and audit logs.
 */
function checkBodySections(
  sections: ParsedSkillFile['sections'],
  issues: SkillValidationIssue[],
): void {
  for (const sectionName of REQUIRED_BODY_SECTIONS) {
    const key = sectionNameToKey(sectionName);
    const content = sections[key];
    if (content === undefined) {
      issues.push({
        type: 'invalid_markdown',
        message:
          `Required body section "${sectionName}" is absent or has no content.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Metadata builder — called only when the issues array is empty
// ---------------------------------------------------------------------------

/**
 * Construct a fully typed, readonly SkillMetadata from a validated raw
 * frontmatter record.
 *
 * All casts here are safe: each field was confirmed to the correct type by its
 * check function before this builder is called. The builder's only job is to
 * assemble the typed object and apply the default for the optional `priority`
 * field.
 *
 * exactOptionalPropertyTypes compliance:
 *   `risk_level` must be physically absent (not set to undefined) when not
 *   present in the frontmatter. Conditional spread achieves this.
 */
function buildMetadata(fm: Record<string, unknown>): SkillMetadata {
  const riskLevel = fm['risk_level'];

  return {
    name:                fm['name']          as string,
    description:         fm['description']   as string,
    version:             fm['version']       as string,
    kind:                fm['kind']          as SkillKind,
    triggers:            fm['triggers']      as readonly string[],
    output_schema:       fm['output_schema'] as SkillOutputSchema,
    // Guardrail literals — the validator confirmed these exact values;
    // `as const` casts satisfy the literal types true/false in SkillMetadata.
    requires_review:     true  as const,
    can_execute:         false as const,
    can_call_tools:      false as const,
    can_bypass_policy:   false as const,
    can_bypass_approval: false as const,
    // priority defaults to 100 when absent (spec-defined default).
    priority: typeof fm['priority'] === 'number' ? fm['priority'] : 100,
    // Conditional spread: omit risk_level entirely when absent or blank.
    ...(isNonEmptyString(riskLevel) ? { risk_level: riskLevel } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the parsed output of a SKILL.md file against the frozen spec.
 *
 *   valid: true  → metadata is fully typed and safe to store in the registry
 *   valid: false → issues contains every violation found in one pass
 *
 * Never throws. All errors are returned as structured SkillValidationIssue
 * objects so that tests can assert on issue.type rather than string messages.
 *
 * @param parsed     The ParsedSkillFile returned by parseSkillFile.
 * @param sourcePath Absolute path to the SKILL.md file; used in error messages.
 */
export function validateSkill(
  parsed: ParsedSkillFile,
  sourcePath: string,
): SkillValidationResult {
  // Defensive guard: the parser guarantees frontmatter is a Record, but the
  // validator must not assume that — it is the authoritative trust boundary.
  if (
    typeof parsed.frontmatter !== 'object' ||
    parsed.frontmatter === null ||
    Array.isArray(parsed.frontmatter)
  ) {
    return {
      valid: false,
      issues: [
        {
          type: 'invalid_yaml',
          message: `${sourcePath}: frontmatter did not parse to a plain object.`,
        },
      ],
    };
  }

  const fm = parsed.frontmatter as Record<string, unknown>;
  const issues: SkillValidationIssue[] = [];

  // ── Required string fields ────────────────────────────────────────────────
  checkRequiredString(fm, 'name', issues);
  checkRequiredString(fm, 'description', issues);

  // ── Version ───────────────────────────────────────────────────────────────
  checkVersion(fm, issues);

  // ── Kind — validate and capture the value for schema cross-check ──────────
  const validatedKind = checkKind(fm, issues);

  // ── Output schema — validated against KIND_SCHEMA_MAP when kind is valid ──
  checkOutputSchema(fm, validatedKind, issues);

  // ── Guardrails — all five must be present and pinned to exact values ───────
  checkGuardrails(fm, issues);

  // ── Triggers ──────────────────────────────────────────────────────────────
  checkTriggers(fm, issues);

  // ── Priority (optional, typed when present) ───────────────────────────────
  checkPriority(fm, issues);

  // ── Required body sections ────────────────────────────────────────────────
  checkBodySections(parsed.sections, issues);

  // ── Result ────────────────────────────────────────────────────────────────
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, metadata: buildMetadata(fm) };
}
