/**
 * UseSteady Skills v1 — core types and interfaces.
 *
 * Architecture invariant: nothing in this file grants execution authority,
 * tool access, policy override, or approval influence.
 * All types here are metadata, schema contracts, and error/audit shapes only.
 */
/**
 * The only valid kind→schema combinations. Validator rejects any SKILL.md
 * whose output_schema does not match this mapping exactly.
 */
export const KIND_SCHEMA_MAP = {
    interpretation: 'usesteady.intent_candidates.v1',
    workflow_generation: 'usesteady.workflow_draft.v1',
    recovery: 'usesteady.recovery_suggestions.v1',
};
// ---------------------------------------------------------------------------
// Required body sections — must all be present; order validated by scanner
// ---------------------------------------------------------------------------
export const REQUIRED_BODY_SECTIONS = [
    'Purpose',
    'When to use',
    'Output contract',
    'Guardrails',
    'Examples',
];
/**
 * Thrown by the parser for YAML / markdown syntax errors and by the validator
 * for spec constraint violations. Carries all issues found in a single pass
 * rather than stopping at the first error.
 */
export class ValidationError extends Error {
    issues;
    constructor(message, issues) {
        super(message);
        this.name = 'ValidationError';
        this.issues = issues;
    }
}
export class SkillLoadError extends Error {
    code;
    sourcePath;
    constructor(code, sourcePath, message) {
        super(`[${code}] ${sourcePath}: ${message}`);
        this.name = 'SkillLoadError';
        this.code = code;
        this.sourcePath = sourcePath;
    }
}
//# sourceMappingURL=types.js.map