/**
 * OCD Evaluator — evaluates a CursorHandoffArtifact against policy rules.
 *
 * ── Role ───────────────────────────────────────────────────────────────────────
 *
 *   Takes the initial artifact produced by the artifact mapper and applies
 *   the three OCD rules that govern Cursor handoffs:
 *
 *     RULE_WRITE_OUTSIDE_WORKSPACE  — file outside write_safe_globs
 *     RULE_WRITE_TOO_MANY_FILES     — allowedFiles count exceeds threshold
 *     RULE_H_PATH_WORKSPACE_BOUNDARY — H-provided path outside workspace root
 *                                      (hard block, not a conflict)
 *
 *   Returns an updated ocdClearance. The artifact itself is not mutated —
 *   callers receive a new ocdClearance to apply.
 *
 * ── What OCD does ─────────────────────────────────────────────────────────────
 *
 *   - Fires conflicts when allowedFiles entries violate write_safe_globs
 *   - Fires conflicts when allowedFiles.length > maxFilesApprovalThreshold
 *   - Returns "cleared" when no rules fire
 *   - Returns "conflict_detected" when one or more rules fire
 *
 * ── What OCD does NOT do ──────────────────────────────────────────────────────
 *
 *   - Does not add to allowedFiles (NEVER proposes files)
 *   - Does not remove from allowedFiles (fires conflict; H decides)
 *   - Does not read the filesystem
 *   - Does not call the intake pipeline
 *
 * ── H-provided path validation ────────────────────────────────────────────────
 *
 *   When H sets allowedFiles from empty, the path must pass two tiers:
 *
 *     Tier 1 — workspace boundary (hard block):
 *       validateHProvidedPath() returns { ok: false } → path rejected, not added
 *
 *     Tier 2 — write_safe_globs (OCD conflict):
 *       evaluateOCDForHandoff() returns conflict_detected → H sees conflict surface
 *
 *   Tier 1 runs in the delivery gate before OCD is called.
 *   Tier 2 runs here in the OCD evaluator.
 *
 * See: docs/cursor-allowedfiles-policy.md — policy rules section
 *      docs/cursor-integration-architecture.md — OCD role in authority model
 */

import * as path from "node:path";
import { matchesGlob } from "./glob-matcher.js";
import { canonicalizeForSafety, CanonicalizationError } from "../safety/canonicalize.js";
import type {
  CursorHandoffArtifact,
  CursorOCDClearance,
  CursorOCDPolicy,
  WorkspacePathValidationResult,
} from "./types.js";

// ─── Rule IDs ────────────────────────────────────────────────────────────────

const RULE_WRITE_OUTSIDE_WORKSPACE  = "RULE_WRITE_OUTSIDE_WORKSPACE";
const RULE_WRITE_TOO_MANY_FILES     = "RULE_WRITE_TOO_MANY_FILES";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate a CursorHandoffArtifact against OCD policy rules.
 *
 * Returns an updated ocdClearance. The artifact is not mutated.
 * Callers apply the returned ocdClearance to the artifact before surfacing
 * it to H.
 *
 * Note: if the artifact already has ocdClearance.status === "conflict_accepted",
 * this function should NOT be called again (H already accepted the conflict).
 * The existing ocdClearance should be preserved unchanged.
 */
export function evaluateOCDForHandoff(
  artifact: CursorHandoffArtifact,
  policy:   CursorOCDPolicy,
): CursorOCDClearance {
  return evaluatePathsAgainstOCDPolicy(artifact.scopeConstraint.allowedFiles, policy);
}

/**
 * Evaluate a set of proposed file paths against OCD policy rules.
 *
 * This IS the constraint authority's rule evaluation — extracted verbatim from
 * evaluateOCDForHandoff() so other surfaces (e.g. the governed-decision kernel's
 * policy sensor, L3.S2) can READ the policy through the authority's own rule
 * code instead of reinterpreting it. Pure function: no filesystem reads, no
 * mutation, deterministic for a given (paths, policy) input.
 *
 * Rules applied (unchanged from the handoff evaluator):
 *   RULE_WRITE_OUTSIDE_WORKSPACE — each path must match write_safe_globs in
 *     BOTH its original and canonical (NFKC/zero-width/BIDI-stripped) form.
 *   RULE_WRITE_TOO_MANY_FILES    — path count must not exceed the threshold.
 */
export function evaluatePathsAgainstOCDPolicy(
  allowedFiles: readonly string[],
  policy:       CursorOCDPolicy,
): CursorOCDClearance {
  const rulesFired:        string[] = [];
  const conflictsDetected: string[] = [];

  // RULE_WRITE_OUTSIDE_WORKSPACE — each file must be within write_safe_globs.
  // Cluster B: a path is "safe" only if BOTH the original-form AND the
  // canonical-form (NFKC + zero-width strip + BIDI strip) match a
  // write_safe_glob. If either form fails, the path is unsafe. This
  // closes the "adjacent surfaces see different interpretations" gap:
  // the OCD glob view and the safety detector view now agree on the
  // canonical identity of the path.
  for (const filePath of allowedFiles) {
    const normalizedPath = normalizePath(filePath);
    const canonicalPath = canonicalizePathForCheck(normalizedPath);

    const matchesAnySafeGlob = (candidate: string): boolean =>
      policy.writeSafeGlobs.some((safeGlob) => matchesGlob(candidate, safeGlob));

    const originalSafe = matchesAnySafeGlob(normalizedPath);
    const canonicalSafe =
      canonicalPath === null ? false : matchesAnySafeGlob(canonicalPath);

    // A path is safe only if both views agree it's safe. Disagreement is
    // treated as unsafe (the more conservative position) — this is the
    // canonical-form-bypass guard.
    const isSafe = originalSafe && canonicalSafe;

    if (!isSafe) {
      if (!rulesFired.includes(RULE_WRITE_OUTSIDE_WORKSPACE)) {
        rulesFired.push(RULE_WRITE_OUTSIDE_WORKSPACE);
      }
      conflictsDetected.push(
        `File '${filePath}' is outside the safe write zone (write_safe_globs).`,
      );
    }
  }

  // RULE_WRITE_TOO_MANY_FILES — allowedFiles count check.
  if (
    allowedFiles.length > 0 &&
    allowedFiles.length > policy.maxFilesApprovalThreshold
  ) {
    rulesFired.push(RULE_WRITE_TOO_MANY_FILES);
    conflictsDetected.push(
      `Too many files in scope: ${allowedFiles.length} (threshold: ${policy.maxFilesApprovalThreshold}).`,
    );
  }

  const status = conflictsDetected.length > 0 ? "conflict_detected" : "cleared";

  return { status, rulesFired, conflictsDetected };
}

/**
 * Validate an H-provided file path against the workspace boundary.
 *
 * This is Tier 1 of H-provided path validation (hard block — not a conflict).
 * Tier 2 (write_safe_globs) is handled by evaluateOCDForHandoff().
 *
 * Called by the delivery gate when H sets allowedFiles from empty, before
 * adding the path to the artifact and before calling the OCD evaluator.
 *
 * A path is valid if and only if:
 *   - It is a non-empty string
 *   - Its resolved form is within the workspace root
 */
export function validateHProvidedPath(
  filePath:      string,
  workspaceRoot: string,
): WorkspacePathValidationResult {
  if (!filePath || filePath.trim().length === 0) {
    return { ok: false, reason: "invalid_path" };
  }

  // Cluster B — run resolution on BOTH original and canonical forms.
  // An H-provided path with zero-width / BIDI obfuscation that visually
  // looks like a contained path but contains hidden traversal markers
  // would otherwise resolve to a contained location under the OS,
  // while an adjacent safety surface (e.g. drift detector) sees the
  // stripped form as escaping. Both views must agree.
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedFile      = path.resolve(workspaceRoot, filePath);

  if (
    !resolvedFile.startsWith(resolvedWorkspace + path.sep)
    && resolvedFile !== resolvedWorkspace
  ) {
    return { ok: false, reason: "outside_workspace_boundary" };
  }

  let canonicalFilePath: string;
  try {
    canonicalFilePath = canonicalizeForSafety(filePath);
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return { ok: false, reason: "outside_workspace_boundary" };
    }
    return { ok: false, reason: "outside_workspace_boundary" };
  }

  // If the canonical form differs from the original AND the canonical
  // form resolves outside the workspace, the original path's
  // OS-resolution agreement was coincidental — the user's intent
  // (after stripping invisible bypass characters) is to escape.
  if (canonicalFilePath !== filePath) {
    const resolvedCanonical = path.resolve(workspaceRoot, canonicalFilePath);
    if (
      !resolvedCanonical.startsWith(resolvedWorkspace + path.sep)
      && resolvedCanonical !== resolvedWorkspace
    ) {
      return { ok: false, reason: "outside_workspace_boundary" };
    }
  }

  return { ok: true };
}

/**
 * Apply a completed ocdClearance to an artifact, returning an updated artifact.
 *
 * Does not mutate. Returns a new artifact reference with ocdClearance replaced.
 * The artifact id is unchanged — ocdClearance is not part of the content-addressed
 * id input (the id reflects what the edit IS, not its current OCD state).
 */
export function applyOCDClearance(
  artifact:     CursorHandoffArtifact,
  ocdClearance: CursorOCDClearance,
): CursorHandoffArtifact {
  return { ...artifact, ocdClearance };
}

/**
 * Mark an artifact's OCD conflict as accepted by H.
 *
 * Called when H explicitly accepts a detected conflict (conflict_detected → conflict_accepted).
 * Preserves rulesFired and conflictsDetected for audit — only status changes.
 */
export function acceptOCDConflict(
  artifact: CursorHandoffArtifact,
): CursorHandoffArtifact {
  return {
    ...artifact,
    ocdClearance: {
      ...artifact.ocdClearance,
      status: "conflict_accepted",
    },
  };
}

// ─── Internal ────────────────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Cluster B helper — return the canonical form of an already-slash-
 * normalized path for safety-check purposes only. The original path
 * is what gets passed to the filesystem; the canonical form is what
 * the glob check evaluates *additionally* to catch obfuscated forms.
 *
 * Returns null on canonicalization failure — callers treat null as
 * "no canonical view available" and default to the conservative
 * verdict (path unsafe). This matches Row 1's fail-closed contract.
 */
function canonicalizePathForCheck(normalizedPath: string): string | null {
  try {
    return canonicalizeForSafety(normalizedPath);
  } catch (err) {
    if (err instanceof CanonicalizationError) return null;
    return null;
  }
}
