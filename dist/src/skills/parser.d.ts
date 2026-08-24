/**
 * UseSteady Skills v1 — parser (file 2 of 8).
 *
 * Single responsibility: read a SKILL.md file from disk, split it into a YAML
 * frontmatter block and a markdown body, parse the YAML with a zero-dependency
 * minimal parser, and locate the five required body sections.
 *
 * This file does NOT validate. It only:
 *   - extracts and structures content
 *   - reports syntax errors (malformed YAML, missing delimiters)
 *
 * Type checking, spec compliance, and guardrail enforcement live in validator.ts.
 *
 * Throws:
 *   SkillLoadError  (FILE_NOT_FOUND)    — file cannot be read from disk
 *   ValidationError (invalid_markdown)  — frontmatter delimiters missing/malformed
 *   ValidationError (invalid_yaml)      — YAML block cannot be parsed
 */
/**
 * Extracted content for the five required body sections.
 * Keys are absent (not undefined) when a section is not found in the body.
 * The validator is responsible for treating absent sections as errors.
 */
export interface ParsedSections {
    readonly purpose?: string;
    readonly whenToUse?: string;
    readonly outputContract?: string;
    readonly guardrails?: string;
    readonly examples?: string;
}
/**
 * The structured output of a successful parse pass.
 * `frontmatter` is deliberately typed as `unknown` — it is still untrusted raw
 * data at this stage. The validator will narrow and enforce types.
 */
export interface ParsedSkillFile {
    readonly frontmatter: unknown;
    readonly body: string;
    readonly sections: ParsedSections;
}
/**
 * Read and parse a single SKILL.md file.
 *
 * Returns a `ParsedSkillFile` whose `frontmatter` field is an untyped object —
 * all type checking and spec validation are deferred to the validator.
 *
 * Throws:
 *   SkillLoadError  (FILE_NOT_FOUND)    — path cannot be read
 *   ValidationError (invalid_markdown)  — delimiter syntax errors
 *   ValidationError (invalid_yaml)      — YAML parse errors
 */
export declare function parseSkillFile(filePath: string): Promise<ParsedSkillFile>;
//# sourceMappingURL=parser.d.ts.map