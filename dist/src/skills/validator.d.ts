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
import { type SkillValidationResult } from './types.js';
import type { ParsedSkillFile } from './parser.js';
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
export declare function validateSkill(parsed: ParsedSkillFile, sourcePath: string): SkillValidationResult;
//# sourceMappingURL=validator.d.ts.map