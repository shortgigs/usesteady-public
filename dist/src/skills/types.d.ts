/**
 * UseSteady Skills v1 — core types and interfaces.
 *
 * Architecture invariant: nothing in this file grants execution authority,
 * tool access, policy override, or approval influence.
 * All types here are metadata, schema contracts, and error/audit shapes only.
 */
/**
 * The only valid skill kinds in v1. Each kind fires under a distinct condition
 * and may only emit its matching output schema.
 */
export type SkillKind = 'interpretation' | 'workflow_generation' | 'recovery';
export type SkillOutputSchema = 'usesteady.intent_candidates.v1' | 'usesteady.workflow_draft.v1' | 'usesteady.recovery_suggestions.v1';
/**
 * The only valid kind→schema combinations. Validator rejects any SKILL.md
 * whose output_schema does not match this mapping exactly.
 */
export declare const KIND_SCHEMA_MAP: {
    readonly interpretation: "usesteady.intent_candidates.v1";
    readonly workflow_generation: "usesteady.workflow_draft.v1";
    readonly recovery: "usesteady.recovery_suggestions.v1";
};
export declare const REQUIRED_BODY_SECTIONS: readonly ["Purpose", "When to use", "Output contract", "Guardrails", "Examples"];
export type RequiredBodySection = (typeof REQUIRED_BODY_SECTIONS)[number];
/**
 * Parsed and validated YAML frontmatter from a SKILL.md file.
 *
 * Guardrail fields use literal types (true / false) rather than boolean so
 * the TypeScript compiler rejects any code that tries to assign a computed
 * boolean to them — drift is a compile-time error, not just a runtime check.
 *
 * exactOptionalPropertyTypes is active: risk_level?: string means the
 * property may be absent, but when present it must be a string (never undefined).
 */
export interface SkillMetadata {
    readonly name: string;
    readonly description: string;
    /** Semantic version string, e.g. "1.0.0". Validator checks parseability. */
    readonly version: string;
    readonly kind: SkillKind;
    readonly triggers: readonly string[];
    readonly output_schema: SkillOutputSchema;
    readonly requires_review: true;
    readonly can_execute: false;
    readonly can_call_tools: false;
    readonly can_bypass_policy: false;
    readonly can_bypass_approval: false;
    /** Optional human-readable risk label. Does not affect loader behaviour. */
    readonly risk_level?: string;
    /**
     * Lower number = evaluated earlier within a kind. Default: 100.
     * Range is not enforced; negative values are allowed for overrides.
     */
    readonly priority: number;
}
export interface Skill {
    readonly metadata: SkillMetadata;
    /** Full markdown body text after the closing --- of the frontmatter block. */
    readonly body: string;
    /** Absolute filesystem path to the SKILL.md file. Used in errors and audit. */
    readonly sourcePath: string;
}
export interface LoadedSkillRegistry {
    /**
     * Skills grouped by kind and sorted by ascending priority within each group.
     * All three kind keys are always present; arrays may be empty.
     */
    readonly byKind: Readonly<Record<SkillKind, readonly Skill[]>>;
    /** Flat list of all loaded skills, in the same order as byKind iteration. */
    readonly all: readonly Skill[];
    /** Timestamp of when buildRegistry() completed successfully. */
    readonly loadedAt: Date;
}
/** Minimal skill identity embedded in every output object. */
export interface SkillRef {
    readonly name: string;
    readonly version: string;
}
export type IntentCandidateKind = 'create_dir' | 'create_file' | 'rename' | 'delete' | 'replace';
interface IntentCandidateBase {
    readonly kind: IntentCandidateKind;
    /**
     * 0–1 float. Advisory only.
     * UseSteady does not use this value for allow/deny decisions.
     */
    readonly confidence: number;
    /** Must name the specific signal in user input that justifies the candidate. */
    readonly reason: string;
}
export interface CreateDirCandidate extends IntentCandidateBase {
    readonly kind: 'create_dir';
    readonly path: string;
}
export interface CreateFileCandidate extends IntentCandidateBase {
    readonly kind: 'create_file';
    readonly path: string;
}
export interface RenameCandidate extends IntentCandidateBase {
    readonly kind: 'rename';
    readonly from: string;
    readonly to: string;
}
export interface DeleteCandidate extends IntentCandidateBase {
    readonly kind: 'delete';
    readonly path: string;
}
export interface ReplaceCandidate extends IntentCandidateBase {
    readonly kind: 'replace';
    readonly find: string;
    readonly replace: string;
    readonly file: string;
}
export type IntentCandidate = CreateDirCandidate | CreateFileCandidate | RenameCandidate | DeleteCandidate | ReplaceCandidate;
export interface IntentCandidatesOutput {
    readonly schema: 'usesteady.intent_candidates.v1';
    readonly skill: SkillRef;
    /** May be empty when no safe candidate can be determined — never fabricate. */
    readonly candidates: readonly IntentCandidate[];
}
export interface WorkflowStep {
    /**
     * Exact phrase the user could type in the workflow builder.
     * Must be independently validatable by the deterministic parser or an
     * interpretation skill.
     */
    readonly input: string;
    readonly reason: string;
}
export interface WorkflowDraftOutput {
    readonly schema: 'usesteady.workflow_draft.v1';
    readonly skill: SkillRef;
    /** Human-readable label for the draft workflow. Empty string when steps is empty. */
    readonly name: string;
    /** May be empty when the request is too vague to decompose safely. */
    readonly steps: readonly WorkflowStep[];
}
export interface RecoverySuggestion {
    /** Exact phrase UseSteady can validate and execute as-is without modification. */
    readonly input: string;
    readonly reason: string;
}
export interface RecoverySuggestionsOutput {
    readonly schema: 'usesteady.recovery_suggestions.v1';
    readonly skill: SkillRef;
    /** May be empty when no safe, explicit suggestion exists — never fabricate. */
    readonly suggestions: readonly RecoverySuggestion[];
}
/** Discriminated union of all valid runtime skill outputs. */
export type SkillOutput = IntentCandidatesOutput | WorkflowDraftOutput | RecoverySuggestionsOutput;
/**
 * A single structured issue emitted during parsing or validation.
 * Carrying `type` as a literal union (rather than a free string) lets callers
 * assert on exact failure reasons in tests without string-matching messages.
 */
export type SkillValidationIssue = {
    readonly type: 'missing_field' | 'invalid_field' | 'schema_mismatch' | 'guardrail_violation' | 'invalid_kind' | 'invalid_yaml' | 'invalid_markdown' | 'unknown_error';
    /**
     * The frontmatter field name involved, when applicable.
     * Absent (not undefined) when the issue is not field-specific.
     */
    readonly field?: string;
    readonly message: string;
};
/**
 * Thrown by the parser for YAML / markdown syntax errors and by the validator
 * for spec constraint violations. Carries all issues found in a single pass
 * rather than stopping at the first error.
 */
export declare class ValidationError extends Error {
    readonly issues: readonly SkillValidationIssue[];
    constructor(message: string, issues: readonly SkillValidationIssue[]);
}
export type SkillErrorCode = 'YAML_PARSE_FAILED' | 'MISSING_REQUIRED_FIELD' | 'INVALID_KIND' | 'SCHEMA_KIND_MISMATCH' | 'GUARDRAIL_VIOLATION' | 'MISSING_BODY_SECTION' | 'INVALID_VERSION' | 'FILE_NOT_FOUND' | 'SCAN_FAILED';
export declare class SkillLoadError extends Error {
    readonly code: SkillErrorCode;
    readonly sourcePath: string;
    constructor(code: SkillErrorCode, sourcePath: string, message: string);
}
/**
 * Discriminated union so callers can narrow on `valid` and get either:
 *   valid: true  → guaranteed typed SkillMetadata (no casts needed in loader)
 *   valid: false → full structured issue list (all issues, not just the first)
 *
 * The old { valid: boolean; errors: string[] } shape was replaced because:
 *   - tests need to assert on issue.type, not a string message
 *   - the loader needs the typed metadata without re-casting unknown fields
 *   - aggregating all issues in one pass requires a structured container
 */
export type SkillValidationResult = {
    readonly valid: true;
    readonly metadata: SkillMetadata;
} | {
    readonly valid: false;
    readonly issues: readonly SkillValidationIssue[];
};
export type TriggerReason = {
    readonly kind: 'interpretation';
    /** Raw input the deterministic parser returned null for. */
    readonly rawInput: string;
} | {
    readonly kind: 'workflow_generation';
    /** Raw input containing an explicit broad or multi-step request. */
    readonly rawInput: string;
} | {
    readonly kind: 'recovery';
    readonly failureReason: 'unsupported' | 'blocked' | 'failed';
    /** Raw input that produced the failure or block. */
    readonly rawInput: string;
};
/**
 * A complete, self-contained record of one skill invocation.
 *
 * Designed to be: serialisable (no functions, no cycles), forward-compatible
 * with a persistence layer, and sufficient for full replay/debugging without
 * re-querying the registry.
 *
 * exactOptionalPropertyTypes fields:
 *   sourcePath?      — absent when the caller did not supply a source map
 *   rejectionReason? — absent when validationOutcome === 'accepted'
 */
export interface SkillAuditRecord {
    readonly skillName: string;
    readonly skillVersion: string;
    /** Absolute path to the SKILL.md file. Absent when the caller did not supply a source map. */
    readonly sourcePath?: string;
    readonly outputSchema: SkillOutputSchema;
    /**
     * The raw output the skill returned, or null if the skill could not be
     * invoked or returned malformed output. Preserved even on schema rejection
     * so the full adapter response is always in the audit trail.
     */
    readonly rawOutput: SkillOutput | null;
    readonly validationOutcome: 'accepted' | 'rejected';
    /** Absent when accepted. Present (as a non-undefined string) when rejected. */
    readonly rejectionReason?: string;
    readonly invokedAt: Date;
    readonly triggerReason: TriggerReason;
    /** The raw user input string that triggered this invocation. */
    readonly rawInput: string;
}
export {};
//# sourceMappingURL=types.d.ts.map