/**
 * UseSteady Skills v1 — loader/scanner (file 4 of 8).
 *
 * Single responsibility: discover all SKILL.md files under a base directory,
 * pipe each through the parser → validator chain, and return a sorted registry
 * of accepted skills alongside a full list of structured rejections.
 *
 * Design rules:
 *   - A broken skill produces a rejection entry and is skipped. It never
 *     prevents other skills from loading (partial-failure guarantee).
 *   - Accepted skills are sorted deterministically:
 *       1. by kind (interpretation → workflow_generation → recovery)
 *       2. then ascending priority (lower number = evaluated first)
 *       3. then source path as a stable alphabetical tie-break
 *   - Each rejection carries its file path, the pipeline stage that failed
 *     (parser or validator), and the full structured issue list.
 *   - No invocation logic, no audit writes, no side effects beyond I/O.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkillFile } from './parser.js';
import { validateSkill } from './validator.js';
import {
  SkillLoadError,
  ValidationError,
  type Skill,
  type SkillKind,
  type SkillValidationIssue,
  type LoadedSkillRegistry,
} from './types.js';

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/**
 * A skill file that was found but could not be loaded at either the
 * parser or validator stage.
 */
export interface SkillRejection {
  readonly sourcePath: string;
  /** Whether the failure occurred during parsing or validation. */
  readonly stage: 'parser' | 'validator';
  /**
   * All structured issues collected at that stage.
   * Parser issues are syntax errors; validator issues are spec violations.
   * Always non-empty.
   */
  readonly issues: readonly SkillValidationIssue[];
}

/** The complete result of a scan pass. */
export interface ScanResult {
  readonly registry: LoadedSkillRegistry;
  readonly rejections: readonly SkillRejection[];
}

// ---------------------------------------------------------------------------
// Directory traversal — manual recursive walk
// ---------------------------------------------------------------------------

/**
 * Recursively collect the absolute paths of all files named exactly SKILL.md
 * under `dir`. Results are sorted alphabetically so that the order passed to
 * the parser/validator chain is deterministic before the priority sort.
 *
 * Uses a manual walk rather than readdir({ recursive: true }) to stay
 * compatible across @types/node versions and keep the traversal explicit.
 * Throws the raw fs error for the caller to wrap as SkillLoadError(SCAN_FAILED).
 */
async function findSkillFiles(dir: string): Promise<readonly string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  results.sort(); // deterministic baseline before priority ordering
  return results;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

/**
 * Numeric order for each SkillKind.
 * interpretation fires first (after parser null), recovery fires last.
 * Implemented as an exhaustive switch rather than a Record lookup to avoid
 * noUncheckedIndexedAccess issues.
 */
function kindOrder(kind: SkillKind): number {
  switch (kind) {
    case 'interpretation':      return 0;
    case 'workflow_generation': return 1;
    case 'recovery':            return 2;
  }
}

/**
 * Comparator for the sorted registry.
 * Tie-breaks at each level before falling through:
 *   1. Kind order (integer, exhaustive)
 *   2. Ascending priority (lower number = evaluated first within a kind)
 *   3. Source path (stable locale-insensitive alphabetical)
 */
function compareSkills(a: Skill, b: Skill): number {
  const kindDiff = kindOrder(a.metadata.kind) - kindOrder(b.metadata.kind);
  if (kindDiff !== 0) return kindDiff;

  const priorityDiff = a.metadata.priority - b.metadata.priority;
  if (priorityDiff !== 0) return priorityDiff;

  return a.sourcePath.localeCompare(b.sourcePath, 'en', { sensitivity: 'base' });
}

// ---------------------------------------------------------------------------
// Registry builder (exported — listed in spec's required functions)
// ---------------------------------------------------------------------------

/**
 * Build a LoadedSkillRegistry from a list of accepted Skill objects.
 *
 * Skills are sorted once via compareSkills, then distributed into per-kind
 * buckets using an exhaustive switch (no index-signature access, safe under
 * noUncheckedIndexedAccess).
 *
 * The `loadedAt` timestamp is recorded here so that callers can compare
 * registry age against source change timestamps if needed.
 */
export function buildRegistry(accepted: readonly Skill[]): LoadedSkillRegistry {
  const sorted: readonly Skill[] = [...accepted].sort(compareSkills);

  const interpretationSkills: Skill[] = [];
  const workflowSkills: Skill[] = [];
  const recoverySkills: Skill[] = [];

  for (const skill of sorted) {
    switch (skill.metadata.kind) {
      case 'interpretation':
        interpretationSkills.push(skill);
        break;
      case 'workflow_generation':
        workflowSkills.push(skill);
        break;
      case 'recovery':
        recoverySkills.push(skill);
        break;
    }
  }

  return {
    byKind: {
      interpretation:      interpretationSkills,
      workflow_generation: workflowSkills,
      recovery:            recoverySkills,
    },
    all:      sorted,
    loadedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Rejection factory
// ---------------------------------------------------------------------------

/**
 * Convert any error thrown by parseSkillFile into a structured SkillRejection.
 *
 * ValidationError → the parser's own issue list is preserved as-is.
 * SkillLoadError  → wrapped as a single unknown_error issue (file unreadable).
 * Anything else   → wrapped as unknown_error (defensive catch-all).
 */
function makeParserRejection(filePath: string, err: unknown): SkillRejection {
  if (err instanceof ValidationError) {
    return {
      sourcePath: filePath,
      stage:      'parser',
      issues:     err.issues,
    };
  }

  const message =
    err instanceof Error
      ? err.message
      : `Unexpected error during parse: ${String(err)}`;

  return {
    sourcePath: filePath,
    stage:      'parser',
    issues:     [{ type: 'unknown_error', message }],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `baseDir` recursively for SKILL.md files, parse and validate each one,
 * and return a sorted registry of accepted skills alongside a full rejection list.
 *
 * Partial-failure guarantee
 * ─────────────────────────
 * Each file is processed independently inside a try/catch. A parse failure,
 * validation failure, or unexpected error for one file produces a SkillRejection
 * and is skipped. Other files continue to load normally.
 *
 * The one unrecoverable case is if the directory itself cannot be read (ENOENT,
 * EACCES, etc.) — that throws SkillLoadError(SCAN_FAILED) because there is
 * nothing meaningful to return.
 *
 * @param baseDir Absolute path to the skills root directory.
 *
 * @throws SkillLoadError(SCAN_FAILED) if baseDir cannot be read.
 */
export async function scanSkillsDirectory(baseDir: string): Promise<ScanResult> {
  // ── Discover SKILL.md files ────────────────────────────────────────────────
  let skillFiles: readonly string[];
  try {
    skillFiles = await findSkillFiles(baseDir);
  } catch (cause) {
    throw new SkillLoadError(
      'SCAN_FAILED',
      baseDir,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  // ── Process each file independently ───────────────────────────────────────
  const accepted: Skill[] = [];
  const rejections: SkillRejection[] = [];

  for (const filePath of skillFiles) {
    // Parse stage — ValidationError and SkillLoadError are both rejections.
    let parsed: Awaited<ReturnType<typeof parseSkillFile>>;
    try {
      parsed = await parseSkillFile(filePath);
    } catch (err) {
      rejections.push(makeParserRejection(filePath, err));
      continue;
    }

    // Validate stage — returns a discriminated result, never throws.
    const result = validateSkill(parsed, filePath);

    if (result.valid) {
      accepted.push({
        metadata:   result.metadata,
        body:       parsed.body,
        sourcePath: filePath,
      });
    } else {
      rejections.push({
        sourcePath: filePath,
        stage:      'validator',
        issues:     result.issues,
      });
    }
  }

  // ── Assemble result ────────────────────────────────────────────────────────
  return {
    registry:   buildRegistry(accepted),
    rejections,
  };
}
