/**
 * UseSteady Skills v1 — local deterministic recovery adapter.
 *
 * ── Purpose ────────────────────────────────────────────────────────────────────
 *
 *   Implements SkillModelAdapter for the recovery skill kind WITHOUT calling
 *   an LLM. Uses keyword detection and simple name extraction to produce
 *   conservative, specific suggestions.
 *
 * ── Authority ──────────────────────────────────────────────────────────────────
 *
 *   Zero. This adapter:
 *     - never executes anything
 *     - never calls tools
 *     - never bypasses approval or policy
 *     - may only return suggestions that the deterministic parser can validate
 *
 * ── Design rules ───────────────────────────────────────────────────────────────
 *
 *   1. Every `input` in a suggestion MUST be parseable by normalizeIntent().
 *      Do not suggest phrases the parser cannot handle.
 *   2. Return `suggestions: []` when the input is too vague or no safe
 *      suggestion exists. Never fabricate plausible-sounding but unsupported inputs.
 *   3. This adapter only handles `usesteady.recovery_suggestions.v1` output.
 *      For other skill output schemas it returns null (declined).
 *   4. No LLM — all logic is deterministic regex/keyword matching.
 *      A real LLM adapter can replace this when a model is available.
 *
 * ── Replacement plan ───────────────────────────────────────────────────────────
 *
 *   When an LLM is available, create an LlmRecoveryAdapter that also implements
 *   SkillModelAdapter. Swap it in at server startup. This adapter stays as the
 *   fallback for offline / zero-API-key environments.
 */

import type { Skill, SkillOutput } from './types.js';
import type { SkillModelAdapter }  from './invocation.js';

// ─── Noise / stop words stripped from name extraction ────────────────────────

/**
 * Words that are NOT candidate names. These are operation verbs, articles,
 * structural prepositions, and type nouns (folder, file) that should not
 * become part of a suggested path.
 */
const NOISE_WORDS = new Set([
  // Operation verbs
  'create', 'make', 'add', 'new', 'build', 'generate', 'set', 'up', 'setup',
  'delete', 'remove', 'rm', 'erase', 'destroy', 'purge',
  'rename', 'move', 'mv',
  // Structural type nouns
  'folder', 'directory', 'dir', 'file',
  // Articles / determiners
  'a', 'an', 'the', 'my', 'our', 'your', 'some', 'this', 'that',
  // Prepositions / connectors
  'for', 'to', 'in', 'at', 'on', 'from', 'into', 'of', 'with',
  // Common filler
  'it', 'one', 'please',
]);

/**
 * Vague meta-words that must NOT become path suggestions.
 * Returning them would fabricate invalid/harmful inputs.
 */
const VAGUE_NAMES = new Set([
  'everything', 'all', 'files', 'stuff', 'things', 'anything', 'something',
  'nothing', 'them', 'those', 'these', 'here', 'there', 'data', 'code',
  'project', 'app', 'repo', 'repository', 'codebase',
  // Vague adjectival / meta names — "make this better" must not become a path.
  'better', 'cleaner', 'nicer', 'faster', 'simpler', 'safer', 'smaller',
  'bigger', 'good', 'bad', 'great', 'best', 'worse', 'right', 'wrong',
  'work', 'working', 'broken', 'fixed', 'done', 'ready', 'clean', 'tidy',
]);

// ─── Single-action gate (truthfulness for SYSTEM SUGGESTS) ────────────────────

/**
 * Maximum word count for an input to be treated as a single, terse, actionable
 * request. Real conversational/audit prompts average ~1,800 chars; a genuine
 * file-op near-miss is short. This bound is the primary defence against
 * fabricating a suggestion from long prose that merely contains a keyword.
 */
const MAX_REQUEST_WORDS = 8;

/**
 * Operation verbs a genuine single-action request begins with. A suggestion is
 * only honest when the input reads as an instruction to perform one of these.
 */
const OP_VERBS = new Set([
  'create', 'make', 'add', 'new', 'build', 'generate', 'set', 'setup',
  'delete', 'remove', 'rm', 'erase', 'destroy', 'purge',
  'rename', 'move', 'mv', 'touch', 'init', 'initialize', 'scaffold', 'write',
]);

/**
 * Content words signalling the request is about a non-filesystem concept
 * (package management, imports). The trailing-token name extractor would
 * fabricate a "delete file <pkg>" suggestion for these, so disqualify them.
 */
const NON_FS_INTENT = new Set([
  'dependency', 'dependencies', 'package', 'packages',
  'import', 'imports', 'module', 'modules',
]);

/**
 * True only when the input plausibly reads as a single, terse, actionable
 * near-miss of a concrete file operation. Long prose, multi-clause requests,
 * and non-action sentences return false so the request falls through to
 * Reflection instead of producing a fabricated SYSTEM SUGGESTS.
 */
function looksLikeSingleActionRequest(rawInput: string): boolean {
  const trimmed = rawInput.trim();
  if (!trimmed) return false;

  // Multi-line input is prose, never a single terse action.
  if (/[\r\n]/.test(trimmed)) return false;

  // Multi-clause: commas, a mid-string sentence terminator followed by more
  // text, or an explicit conjunction joining a second clause.
  if (/,/.test(trimmed)) return false;
  if (/[.!?;]\s+\S/.test(trimmed)) return false;
  if (/\b(and|then|also|but|because|so|after|before|while)\b/i.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/);
  if (words.length > MAX_REQUEST_WORDS) return false;

  // Must begin with an operation verb (after stripping leading punctuation).
  const first = (words[0] ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!OP_VERBS.has(first)) return false;

  // Disqualify non-filesystem intents (package/import management).
  if (words.some(w => NON_FS_INTENT.has(w.toLowerCase().replace(/[^a-z]/g, '')))) {
    return false;
  }

  return true;
}

// ─── Name extraction ──────────────────────────────────────────────────────────

/**
 * Extract the most likely intended name/path from a raw input string.
 *
 * Strategy:
 *   1. Strip common polite prefixes ("please", "can you", etc.).
 *   2. If "called <X>" or "named <X>" anchor is present, use X (most reliable).
 *   3. Remove all NOISE_WORDS.
 *   4. Take the last remaining word (usually the specific identifier).
 *   5. Return null if the result is a VAGUE_NAME or nothing is left.
 *
 * Returns null to signal "no safe name found — do not suggest".
 */
function extractLikelyName(rawInput: string): string | null {
  const lower = rawInput.toLowerCase().trim();

  // Step 1 — strip polite prefix
  const stripped = lower
    .replace(/^(please\s+|can\s+you\s+|could\s+you\s+|i\s+(?:want\s+(?:to\s+)?|need\s+(?:to\s+)?)?)/, '')
    .trim();

  // Step 2 — "called/named X" anchor
  const calledMatch = /\b(?:called|named)\s+(\S+)/.exec(stripped);
  if (calledMatch?.[1]) {
    const candidate = calledMatch[1];
    return VAGUE_NAMES.has(candidate) ? null : candidate;
  }

  // Step 3+4 — remove noise, take last word
  const words = stripped
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9._/-]/g, ''))  // keep path chars
    .filter(w => w.length > 0 && !NOISE_WORDS.has(w));

  if (words.length === 0) return null;

  const name = words[words.length - 1]!;

  // Step 5 — reject vague names
  return VAGUE_NAMES.has(name) ? null : name;
}

// ─── Suggestion builder ───────────────────────────────────────────────────────

type LocalSuggestion = { readonly input: string; readonly reason: string };

/**
 * Analyse a raw input and produce 0–2 safe recovery suggestions.
 *
 * Returns [] (empty) when:
 *   - no recognisable operation keyword is found
 *   - the extracted name is vague or absent
 *   - the operation is fundamentally unsupported
 *
 * All returned `input` values are parseable by the deterministic parser.
 */
function buildSuggestions(rawInput: string): readonly LocalSuggestion[] {
  const lower = rawInput.toLowerCase().trim();
  if (!lower) return [];

  // Truthfulness gate: only terse, single-action near-misses may produce a
  // suggestion. Everything else falls through to Reflection (return []).
  if (!looksLikeSingleActionRequest(rawInput)) return [];

  // Edit-into-existing-file guard: "<verb> X to/into <name>.<ext>" describes
  // operating ON an already-existing file (adding content to it, relocating
  // into it), NOT creating or renaming that file. The trailing-token name
  // extractor would otherwise fabricate "create <existing-file>" — e.g.
  // "add zod to package.json" -> "create file package.json", or
  // "add an @ alias to vite.config.ts" -> "create file vite.config.ts". No
  // truthful single-token suggestion exists, so deflect to Reflection.
  if (/\b(?:to|into)\s+\S*\.[a-z0-9]+\s*$/i.test(lower)) return [];

  const isCreate = /\b(create|make|add|new|build|generate|set\s+up|setup)\b/.test(lower);
  const isDelete = /\b(delete|remove|rm|erase)\b/.test(lower);
  const isRename = /\b(rename|move|mv)\b/.test(lower);
  const isDir    = /\b(folder|directory|dir)\b/.test(lower);
  const isFile   = /\b(file)\b/.test(lower);

  const name = extractLikelyName(rawInput);

  // ── Creation ──────────────────────────────────────────────────────────────
  if (isCreate) {
    if (!name) return [];  // can't suggest without a name
    if (isDir && !isFile) {
      return [{ input: `create folder ${name}`, reason: 'Supported form for folder creation' }];
    }
    if (isFile && !isDir) {
      return [{ input: `create file ${name}`, reason: 'Supported form for file creation' }];
    }
    // Ambiguous: suggest both (folder first — usually what natural language implies)
    return [
      { input: `create folder ${name}`, reason: 'If this should be a directory' },
      { input: `create file ${name}`,   reason: 'If this should be a file' },
    ];
  }

  // ── Deletion ──────────────────────────────────────────────────────────────
  if (isDelete) {
    if (!name) return [];
    return [
      { input: `delete file ${name}`,   reason: 'If this is a file' },
      { input: `delete folder ${name}`, reason: 'If this is a directory' },
    ];
  }

  // ── Rename / move ─────────────────────────────────────────────────────────
  if (isRename) {
    // The clarify template `rename <src> to <new-name>` is only honest when the
    // user named a source but gave NO destination (e.g. "rename utils.ts").
    // When a destination preposition is present ("rename X to Y", "move A into
    // B"), the trailing token the extractor picks is the DESTINATION, so naming
    // it as the source would fabricate — e.g. "move the old config into the
    // archive folder" -> "rename archive to <new-name>". Deflect to Reflection.
    if (/\b(?:to|into)\b/i.test(lower)) return [];
    if (!name) return [];
    return [
      {
        input:  `rename ${name} to <new-name>`,
        reason: 'Fill in the destination path to complete the rename',
      },
    ];
  }

  // Unrecognised operation — don't fabricate
  return [];
}

// ─── Adapter implementation ───────────────────────────────────────────────────

/**
 * LocalRecoveryAdapter — deterministic SkillModelAdapter for the recovery kind.
 *
 * Returns a RecoverySuggestionsOutput built from keyword analysis.
 * Returns null (declined) for non-recovery skill output schemas.
 *
 * This adapter satisfies SkillModelAdapter and can be replaced by an
 * LLM-backed adapter without changing any call sites.
 */
export class LocalRecoveryAdapter implements SkillModelAdapter {
  async invoke(skill: Skill, rawInput: string): Promise<SkillOutput | null> {
    // Decline gracefully for non-recovery schemas.
    // The invocation helper will record this as a rejection with reason "declined".
    if (skill.metadata.output_schema !== 'usesteady.recovery_suggestions.v1') {
      return null;
    }

    const suggestions = buildSuggestions(rawInput);

    return {
      schema:      'usesteady.recovery_suggestions.v1',
      skill:       { name: skill.metadata.name, version: skill.metadata.version },
      suggestions,
    };
  }
}
