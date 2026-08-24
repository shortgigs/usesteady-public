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
import { type Skill, type SkillValidationIssue, type LoadedSkillRegistry } from './types.js';
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
export declare function buildRegistry(accepted: readonly Skill[]): LoadedSkillRegistry;
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
export declare function scanSkillsDirectory(baseDir: string): Promise<ScanResult>;
//# sourceMappingURL=loader.d.ts.map