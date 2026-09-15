/**
 * Drift detector — Layer 3 of the ControlEnvelope pipeline.
 *
 * V1 strategy: forbidden_term_scan.
 *
 * Scans a proposed plan description (the SYSTEM WILL text) for any term from
 * the FORBIDDEN_RUNTIME_TERMS list. Returns all findings as human-readable
 * conflict strings.
 *
 * Design rules:
 *   - Case-insensitive matching only
 *   - Returns ALL findings, not just the first (fail-full, not fail-fast)
 *   - Each conflict string names the exact term found and where
 *   - Does not mutate input
 *   - Does not read the filesystem
 *   - Does not call the intake pipeline
 *
 * See: docs/control-envelope-v1-spec.md — Layer 3
 */

import { FORBIDDEN_RUNTIME_TERMS } from "./constraints.js";
import type { ControlEnvelope } from "./types.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DriftScanResult = {
  status: "clear" | "conflict";
  conflicts: string[];
  mode: "forbidden_term_scan";
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan a plan text for forbidden runtime / shell / architecture terms.
 *
 * @param planText - The SYSTEM WILL summary or proposed plan description.
 *                   Pass the full text; multiple lines are fine.
 * @returns DriftScanResult — status, all conflicts found, detection mode.
 */
export function detectForbiddenTerms(planText: string): DriftScanResult {
  const lower = planText.toLowerCase();
  const conflicts: string[] = [];

  for (const term of FORBIDDEN_RUNTIME_TERMS) {
    if (containsTerm(lower, term.toLowerCase())) {
      conflicts.push(buildConflictMessage(term, planText));
    }
  }

  return {
    status: conflicts.length > 0 ? "conflict" : "clear",
    conflicts,
    mode: "forbidden_term_scan",
  };
}

/**
 * Scan individual strings from plannedChanges.summary and plannedChanges.files.
 * Convenience wrapper over detectForbiddenTerms for structured envelope fields.
 *
 * @param summary - The plannedChanges.summary array.
 * @param files   - The plannedChanges.files array.
 */
export function detectForbiddenTermsInPlan(
  summary: string[],
  files: string[],
): DriftScanResult {
  const combined = [...summary, ...files].join("\n");
  return detectForbiddenTerms(combined);
}

/**
 * Validate a raw request string for obvious forbidden terms.
 * Used by the compiler before the plan is produced to catch early signals.
 */
export function detectForbiddenTermsInRequest(rawRequest: string): DriftScanResult {
  return detectForbiddenTerms(rawRequest);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether the (already-lowercased) text contains the (already-lowercased)
 * term as a standalone word or substring.
 *
 * Word-boundary check: surround the match site with non-alphanumeric characters
 * (or start/end of string) so "forge" doesn't trigger on "forgettable".
 * Exception: terms that contain non-alpha characters (e.g. "electron-vite",
 * "app.whenReady") are matched as plain substrings because word-boundary logic
 * would incorrectly fragment them.
 */
function containsTerm(lowerText: string, lowerTerm: string): boolean {
  if (!lowerText.includes(lowerTerm)) return false;

  // Terms with non-alpha characters are matched as plain substrings.
  if (/[^a-z]/.test(lowerTerm)) return true;

  // Word-boundary check for pure-alpha terms.
  const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "i");
  return re.test(lowerText);
}

/**
 * Build a human-readable conflict message for a found term.
 * Includes a short context excerpt to help the reviewer locate the finding.
 */
function buildConflictMessage(term: string, originalText: string): string {
  const excerpt = extractExcerpt(originalText, term);
  return excerpt
    ? `Forbidden runtime term "${term}" found in plan: "…${excerpt}…"`
    : `Forbidden runtime term "${term}" found in plan.`;
}

/**
 * Extract a short context excerpt around the first occurrence of a term.
 * Returns an empty string if the term is not found (should not happen after
 * containsTerm passes, but guards defensive code).
 */
function extractExcerpt(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return "";

  const start = Math.max(0, idx - 20);
  const end   = Math.min(text.length, idx + term.length + 20);
  return text.slice(start, end).replace(/\n/g, " ").trim();
}

// ─── Narrowing helpers (for use by compiler and callers) ─────────────────────

/** Convert a DriftScanResult to the drift field shape of ControlEnvelope. */
export function toDriftField(
  result: DriftScanResult,
): ControlEnvelope["drift"] {
  return {
    status:    result.status,
    conflicts: result.conflicts,
    mode:      result.mode,
  };
}
