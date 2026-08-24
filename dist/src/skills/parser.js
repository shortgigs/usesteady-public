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
import { readFile } from 'node:fs/promises';
import { SkillLoadError, ValidationError, } from './types.js';
// ---------------------------------------------------------------------------
// Step 1 — frontmatter / body splitter
// ---------------------------------------------------------------------------
/**
 * Split raw SKILL.md content into a YAML string and the markdown body.
 *
 * Rules enforced here (syntax only — not spec compliance):
 *   - File must start with `---` (after optional UTF-8 BOM)
 *   - A closing `---` on its own line must be present
 *   - The YAML block between the delimiters must be non-empty
 *
 * Only the first frontmatter block is processed. Any subsequent `---` lines
 * in the body are treated as body content.
 */
function extractFrontmatterAndBody(content, sourcePath) {
    // Strip optional UTF-8 BOM so editors that add it don't break the parser.
    const text = content.startsWith('\uFEFF') ? content.slice(1) : content;
    if (!text.startsWith('---')) {
        throw new ValidationError(`${sourcePath}: missing frontmatter opening delimiter`, [
            {
                type: 'invalid_markdown',
                message: 'File does not begin with a --- frontmatter delimiter.',
            },
        ]);
    }
    // Everything after the three opening dashes.
    const afterOpening = text.slice(3);
    // Find the closing `---` on its own line.
    // The `m` flag makes `^` and `$` match at line boundaries.
    // `\s*` tolerates a trailing carriage return on Windows.
    const closingMatch = /^---\s*$/m.exec(afterOpening);
    if (closingMatch === null) {
        throw new ValidationError(`${sourcePath}: missing frontmatter closing delimiter`, [
            {
                type: 'invalid_markdown',
                message: 'No closing --- delimiter found; the frontmatter block is not terminated.',
            },
        ]);
    }
    const yaml = afterOpening.slice(0, closingMatch.index).trim();
    if (yaml.length === 0) {
        throw new ValidationError(`${sourcePath}: empty frontmatter block`, [
            {
                type: 'invalid_markdown',
                message: 'The frontmatter block between --- delimiters is empty.',
            },
        ]);
    }
    // Skip past the closing --- line itself (index + matched length).
    const body = afterOpening
        .slice(closingMatch.index + closingMatch[0].length)
        .trim();
    return { yaml, body };
}
// ---------------------------------------------------------------------------
// Step 2 — minimal zero-dependency YAML parser
// ---------------------------------------------------------------------------
/**
 * Parse a single scalar YAML value into a TypeScript primitive.
 *
 * Supported forms:
 *   true / false   → boolean
 *   integers       → number (via Number())
 *   "quoted"       → string with quotes stripped
 *   'quoted'       → string with quotes stripped
 *   plain text     → string as-is
 *
 * null / ~ is treated as an empty string so the validator can report it as a
 * missing field rather than a type error.
 */
function parseScalar(raw) {
    if (raw === 'true')
        return true;
    if (raw === 'false')
        return false;
    if (raw === 'null' || raw === '~')
        return '';
    const asNumber = Number(raw);
    if (raw !== '' && !Number.isNaN(asNumber))
        return asNumber;
    if ((raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
        (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)) {
        return raw.slice(1, -1);
    }
    return raw;
}
/**
 * Parse the YAML subset used in SKILL.md frontmatter.
 *
 * Supported subset (deliberately minimal):
 *   key: scalar value
 *   key:                   ← introduces a block sequence
 *     - item               ← sequence item (any indent before the dash)
 *
 * Explicitly rejected (fail-fast with invalid_yaml):
 *   nested objects         { key: { nested: value } }
 *   flow sequences         [a, b, c]
 *   block scalars          key: |  or  key: >
 *   YAML anchors / aliases &anchor  *ref
 *   indented non-sequence  lines that are indented but not array items
 *
 * Returns a plain Record<string, unknown>; type checking is the
 * validator's responsibility.
 */
function parseMinimalYaml(text, sourcePath) {
    const result = {};
    const issues = [];
    let state = { mode: 'idle' };
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // trimEnd removes trailing \r on Windows; trimStart is intentionally absent
        // so we can detect indentation.
        const line = (lines[i] ?? '').trimEnd();
        // Skip blank lines and full-line comments.
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue;
        // ── Reject unsupported constructs early ──────────────────────────────────
        // Flow sequences and flow mappings.
        if (/^[\w][\w-]*\s*:\s*[\[{]/.test(line)) {
            issues.push({
                type: 'invalid_yaml',
                message: `Line ${i + 1}: flow sequences and mappings are not supported: ${line}`,
            });
            continue;
        }
        // Block scalars (| or >).
        if (/^[\w][\w-]*\s*:\s*[|>]/.test(line)) {
            issues.push({
                type: 'invalid_yaml',
                message: `Line ${i + 1}: block scalars (| >) are not supported: ${line}`,
            });
            continue;
        }
        // Anchors and aliases.
        if (/^[\w][\w-]*\s*:\s*[&*]/.test(line) || trimmed.startsWith('*')) {
            issues.push({
                type: 'invalid_yaml',
                message: `Line ${i + 1}: anchors and aliases are not supported: ${line}`,
            });
            continue;
        }
        // ── Array item: leading whitespace + "- value" ───────────────────────────
        const arrayItemMatch = /^[ \t]+-[ \t]+(.+)$/.exec(line);
        if (arrayItemMatch !== null) {
            if (state.mode !== 'array') {
                issues.push({
                    type: 'invalid_yaml',
                    message: `Line ${i + 1}: array item found outside an array context: ${line}`,
                });
                continue;
            }
            const item = (arrayItemMatch[1] ?? '').trim();
            const existing = result[state.key];
            if (Array.isArray(existing)) {
                existing.push(item);
            }
            continue;
        }
        // ── Indented line that is not an array item ──────────────────────────────
        // This catches nested mappings and other unsupported indented constructs.
        if (/^[ \t]+\S/.test(line)) {
            issues.push({
                type: 'invalid_yaml',
                message: `Line ${i + 1}: unexpected indented content (nested objects are not supported): ${line}`,
            });
            continue;
        }
        // ── Key-value pair ───────────────────────────────────────────────────────
        // Key names: word characters and hyphens (covers can_execute, risk_level…).
        const kvMatch = /^([\w][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (kvMatch !== null) {
            const key = kvMatch[1] ?? '';
            const rawValue = (kvMatch[2] ?? '').trim();
            if (key === '') {
                // Guard: regex guarantees a non-empty group[1], but noUncheckedIndexedAccess
                // requires an explicit check before use.
                issues.push({
                    type: 'invalid_yaml',
                    message: `Line ${i + 1}: empty key`,
                });
                continue;
            }
            if (rawValue === '') {
                // Empty value after colon → start of a block sequence.
                result[key] = [];
                state = { mode: 'array', key };
            }
            else {
                result[key] = parseScalar(rawValue);
                state = { mode: 'idle' };
            }
            continue;
        }
        // ── Unrecognised line ────────────────────────────────────────────────────
        issues.push({
            type: 'invalid_yaml',
            message: `Line ${i + 1}: cannot parse line: ${line}`,
        });
    }
    if (issues.length > 0) {
        throw new ValidationError(`${sourcePath}: YAML parse failed with ${issues.length} issue(s)`, issues);
    }
    return result;
}
/**
 * Locate all headings in the markdown body and extract the trimmed text
 * content that belongs to each of the five required sections.
 *
 * Matching rules:
 *   - Any heading level is accepted (# through ######).
 *   - Matching is case-insensitive.
 *   - Section content runs from the line after the matched heading to just
 *     before the next heading at the SAME or HIGHER level (fewer `#` signs).
 *     Deeper subheadings (`###`, `####`, …) within a section are included
 *     in that section's content — they do not terminate it.
 *   - A section with no content (only whitespace) is treated as absent,
 *     the same as a completely missing section.
 *
 * Never throws — absent sections are simply omitted from the result object.
 * The validator is responsible for reporting missing required sections.
 *
 * exactOptionalPropertyTypes compliance: absent sections are built with
 * conditional spread so the key is physically absent, not set to undefined.
 */
function extractSections(body) {
    // Capture both the `#` sequence (for level) and the heading text.
    const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;
    const headings = [];
    let match;
    while ((match = headingPattern.exec(body)) !== null) {
        const hashes = match[1] ?? '';
        const rawText = (match[2] ?? '').trim();
        headings.push({
            level: hashes.length,
            normText: rawText.toLowerCase(),
            lineStart: match.index,
            contentStart: match.index + match[0].length,
        });
    }
    /**
     * Return trimmed content under the named section, or undefined if the
     * heading is absent or the section has no non-whitespace content.
     *
     * The section boundary is the next heading at the same or higher level
     * (level number ≤ this heading's level), NOT the first heading of any level.
     * This allows `###` subheadings inside a `##` section without truncating it.
     */
    function getSection(normalisedName) {
        const idx = headings.findIndex((h) => h.normText === normalisedName);
        if (idx === -1)
            return undefined;
        const heading = headings[idx];
        if (heading === undefined)
            return undefined; // noUncheckedIndexedAccess guard
        // Find the next heading at the same or higher level (= fewer `#` signs).
        let end = body.length;
        for (let j = idx + 1; j < headings.length; j++) {
            const candidate = headings[j];
            if (candidate !== undefined && candidate.level <= heading.level) {
                end = candidate.lineStart;
                break;
            }
        }
        const content = body.slice(heading.contentStart, end).trim();
        return content.length > 0 ? content : undefined;
    }
    // Resolve each section independently before building the result object.
    const purpose = getSection('purpose');
    const whenToUse = getSection('when to use');
    const outputContract = getSection('output contract');
    const guardrails = getSection('guardrails');
    const examples = getSection('examples');
    // Conditional spread ensures absent sections are physically omitted from the
    // object (required by exactOptionalPropertyTypes: true).
    // Pattern: (value !== undefined ? { key: value } : {})
    return {
        ...(purpose !== undefined ? { purpose } : {}),
        ...(whenToUse !== undefined ? { whenToUse } : {}),
        ...(outputContract !== undefined ? { outputContract } : {}),
        ...(guardrails !== undefined ? { guardrails } : {}),
        ...(examples !== undefined ? { examples } : {}),
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
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
export async function parseSkillFile(filePath) {
    // ── Read from disk ─────────────────────────────────────────────────────────
    let content;
    try {
        content = await readFile(filePath, 'utf-8');
    }
    catch (cause) {
        throw new SkillLoadError('FILE_NOT_FOUND', filePath, cause instanceof Error ? cause.message : String(cause));
    }
    // ── Split frontmatter from body ────────────────────────────────────────────
    const { yaml, body } = extractFrontmatterAndBody(content, filePath);
    // ── Parse YAML (zero dependencies) ────────────────────────────────────────
    const frontmatter = parseMinimalYaml(yaml, filePath);
    // ── Extract body sections (never throws) ──────────────────────────────────
    const sections = extractSections(body);
    return { frontmatter, body, sections };
}
//# sourceMappingURL=parser.js.map