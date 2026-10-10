/**
 * UseSteady Skills v1 — core types and interfaces.
 *
 * Architecture invariant: nothing in this file grants execution authority,
 * tool access, policy override, or approval influence.
 * All types here are metadata, schema contracts, and error/audit shapes only.
 */

// ---------------------------------------------------------------------------
// Skill kinds — the three allowed categories in v1
// ---------------------------------------------------------------------------

/**
 * The only valid skill kinds in v1. Each kind fires under a distinct condition
 * and may only emit its matching output schema.
 */
export type SkillKind =
  | 'interpretation'       // fires after deterministic parser returns null
  | 'workflow_generation'  // fires on explicit broad / multi-step requests only
  | 'recovery';            // fires after unsupported / blocked / failed outcomes

// ---------------------------------------------------------------------------
// Output schemas — one per kind; the kind→schema mapping is enforced at load
// ---------------------------------------------------------------------------

export type SkillOutputSchema =
  | 'usesteady.intent_candidates.v1'
  | 'usesteady.workflow_draft.v1'
  | 'usesteady.recovery_suggestions.v1';

/**
 * The only valid kind→schema combinations. Validator rejects any SKILL.md
 * whose output_schema does not match this mapping exactly.
 */
export const KIND_SCHEMA_MAP = {
  interpretation:      'usesteady.intent_candidates.v1',
  workflow_generation: 'usesteady.workflow_draft.v1',
  recovery:            'usesteady.recovery_suggestions.v1',
} as const satisfies Record<SkillKind, SkillOutputSchema>;

// ---------------------------------------------------------------------------
// Required body sections — must all be present; order validated by scanner
// ---------------------------------------------------------------------------

export const REQUIRED_BODY_SECTIONS = [
  'Purpose',
  'When to use',
  'Output contract',
  'Guardrails',
  'Examples',
] as const;

export type RequiredBodySection = (typeof REQUIRED_BODY_SECTIONS)[number];

// ---------------------------------------------------------------------------
// Skill metadata — parsed from YAML frontmatter
// ---------------------------------------------------------------------------

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

  // Guardrail booleans — pinned to safe values by the validator.
  // Literal types ensure no runtime path can silently deviate.
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

// ---------------------------------------------------------------------------
// Loaded skill — metadata + body text + source location
// ---------------------------------------------------------------------------

export interface Skill {
  readonly metadata: SkillMetadata;
  /** Full markdown body text after the closing --- of the frontmatter block. */
  readonly body: string;
  /** Absolute filesystem path to the SKILL.md file. Used in errors and audit. */
  readonly sourcePath: string;
}

// ---------------------------------------------------------------------------
// Registry — the product of a complete, successful load pass
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Output schema types — the shapes a skill may emit at runtime
//
// The loader and validator do not produce these — they are the expected
// output shapes that external skill implementations must conform to.
// Included here so UseSteady's validation layer can type-check skill output.
// ---------------------------------------------------------------------------

/** Minimal skill identity embedded in every output object. */
export interface SkillRef {
  readonly name: string;
  readonly version: string;
}

// --- usesteady.intent_candidates.v1 ---

export type IntentCandidateKind =
  | 'create_dir'
  | 'create_file'
  | 'rename'
  | 'delete'
  | 'replace';

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

export type IntentCandidate =
  | CreateDirCandidate
  | CreateFileCandidate
  | RenameCandidate
  | DeleteCandidate
  | ReplaceCandidate;

export interface IntentCandidatesOutput {
  readonly schema: 'usesteady.intent_candidates.v1';
  readonly skill: SkillRef;
  /** May be empty when no safe candidate can be determined — never fabricate. */
  readonly candidates: readonly IntentCandidate[];
}

// --- usesteady.workflow_draft.v1 ---

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

// --- usesteady.recovery_suggestions.v1 ---

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
export type SkillOutput =
  | IntentCandidatesOutput
  | WorkflowDraftOutput
  | RecoverySuggestionsOutput;

// ---------------------------------------------------------------------------
// Structured validation issue — used by parser, validator, and audit logger
// ---------------------------------------------------------------------------

/**
 * A single structured issue emitted during parsing or validation.
 * Carrying `type` as a literal union (rather than a free string) lets callers
 * assert on exact failure reasons in tests without string-matching messages.
 */
export type SkillValidationIssue = {
  readonly type:
    | 'missing_field'      // a required frontmatter field is absent
    | 'invalid_field'      // a field is present but has an illegal value
    | 'schema_mismatch'    // output_schema does not match the kind
    | 'guardrail_violation'// a guardrail boolean is not set to its required value
    | 'invalid_kind'       // kind is not one of the three allowed values
    | 'invalid_yaml'       // frontmatter YAML cannot be parsed
    | 'invalid_markdown'   // frontmatter block is missing or malformed
    | 'unknown_error';
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
export class ValidationError extends Error {
  readonly issues: readonly SkillValidationIssue[];

  constructor(message: string, issues: readonly SkillValidationIssue[]) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type SkillErrorCode =
  | 'YAML_PARSE_FAILED'      // frontmatter could not be parsed
  | 'MISSING_REQUIRED_FIELD' // a required frontmatter field is absent
  | 'INVALID_KIND'           // kind is not one of the three allowed values
  | 'SCHEMA_KIND_MISMATCH'   // output_schema does not match allowed schema for kind
  | 'GUARDRAIL_VIOLATION'    // a guardrail boolean deviates from its required value
  | 'MISSING_BODY_SECTION'   // a required markdown body section is absent
  | 'INVALID_VERSION'        // version field is absent or not parseable as semver
  | 'FILE_NOT_FOUND'         // SKILL.md could not be read from disk
  | 'SCAN_FAILED';           // skills directory could not be scanned

export class SkillLoadError extends Error {
  readonly code: SkillErrorCode;
  readonly sourcePath: string;

  constructor(code: SkillErrorCode, sourcePath: string, message: string) {
    super(`[${code}] ${sourcePath}: ${message}`);
    this.name = 'SkillLoadError';
    this.code = code;
    this.sourcePath = sourcePath;
  }
}

// ---------------------------------------------------------------------------
// Validation result — returned by validateSkill; does not throw
// ---------------------------------------------------------------------------

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
export type SkillValidationResult =
  | { readonly valid: true; readonly metadata: SkillMetadata }
  | { readonly valid: false; readonly issues: readonly SkillValidationIssue[] };

// ---------------------------------------------------------------------------
// Trigger context — describes why getTriggerableSkills was called
// ---------------------------------------------------------------------------

export type TriggerReason =
  | {
      readonly kind: 'interpretation';
      /** Raw input the deterministic parser returned null for. */
      readonly rawInput: string;
    }
  | {
      readonly kind: 'workflow_generation';
      /** Raw input containing an explicit broad or multi-step request. */
      readonly rawInput: string;
    }
  | {
      readonly kind: 'recovery';
      readonly failureReason: 'unsupported' | 'blocked' | 'failed';
      /** Raw input that produced the failure or block. */
      readonly rawInput: string;
    };

// ---------------------------------------------------------------------------
// Audit record — emitted after each skill invocation attempt
// ---------------------------------------------------------------------------

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
