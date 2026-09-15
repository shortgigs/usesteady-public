import type { SafetyDetector, SafetyResult } from "../types.js";

// Per-pattern `note` (S1 / friction #28): the path-traversal pattern was
// added to this detector's PATTERNS list as an expedient catch-all, but
// the detector body returned a single hardcoded note ("...irreversible
// bulk data destruction.") for every match. That made the user-facing
// `Blocked: <note>` line factually wrong for traversal — the block was
// correct, the reason was a lie. The optional per-pattern `note` lets a
// pattern carry its own user-visible explanation; patterns without a
// `note` keep the original destructive-action wording.
//
// Scope of #28 (locked):
//   - User-facing `note` text only.
//   - SafetyReason / detectorId / matchedPattern / public error code /
//     exit code / detector registry / UCP types / telemetry schema /
//     workspace boundary logic are ALL intentionally untouched. The
//     telemetry collateral (reason still recorded as
//     "destructive_mass_action" for traversal) is acceptable per the
//     locked plan.
type LabeledPattern = {
  readonly regex: RegExp;
  readonly label: string;
  readonly note?: string;
};

const DEFAULT_NOTE =
  "Input contains a pattern associated with irreversible bulk data destruction.";

const PATTERNS: ReadonlyArray<LabeledPattern> = [
  { regex: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i, label: "rm -rf" },
  { regex: /\bgit\s+push\s+--force(?:-with-lease)?\b/i, label: "git push --force" },
  { regex: /\bgit\s+filter-branch\b/i,                label: "git filter-branch" },
  { regex: /\bdrop\s+database\b/i,                    label: "drop database" },
  { regex: /\bdelete\s+all\b/i,               label: "delete all" },
  { regex: /\bwipe\b/i,                        label: "wipe" },
  { regex: /\bpurge\b/i,                       label: "purge" },
  // USESTEADY_HOSTILE_SCOPE_DETECTOR_COVERAGE_IMPL_V1 (#845): semantic equivalents
  // of the mass-destruction patterns above, measured as coverage misses in
  // USESTEADY_HOSTILE_SCOPE_SAFETY_GATE_CHARACTERIZATION_V1 (#844). Same policy
  // intent (destructive_mass_action) — additional surface forms only, no new
  // category. "everything" is inherently total and matched bare; "all"/verb forms
  // are scoped to destructive targets so benign bulk edits ("remove all comments",
  // "truncate the description") are unaffected. Appended after the existing
  // patterns so first-match labels above are preserved.
  { regex: /\bdelete\s+everything\b/i,         label: "delete everything" },
  { regex: /\bremove\s+everything\b/i,         label: "remove everything" },
  { regex: /\bremove\s+all\s+(?:the\s+|our\s+|your\s+)?(?:data|files?|records?|rows?|tables?|databases?|users?|customers?|accounts?|secrets?)\b/i, label: "remove all (data/files/records)" },
  { regex: /\berase\s+(?:all|everything|the\s+(?:entire|whole|repo|repository|database|production))\b/i, label: "erase (mass)" },
  { regex: /\bdestroy\s+(?:all|everything|the\s+(?:entire|whole|production|prod|database))\b/i, label: "destroy (mass/production)" },
  { regex: /\btruncate\s+(?:\w+\s+){0,3}tables?\b/i, label: "truncate table(s)" },
  { regex: /\btruncate\s+database\b/i,         label: "truncate database" },
  // Path traversal — targets outside the workspace (../../etc/passwd, etc.).
  // Per #28: this category was being mislabeled as "bulk data destruction".
  // It still lives in this detector to keep the registry / SafetyReason /
  // UCP surface unchanged, but it now carries its own per-pattern note.
  {
    regex: /\.\.[\\/]/,
    label: "path traversal (../)",
    note:  "Path traversal detected. File paths must stay within the current workspace.",
  },
];

function findMatch(input: string): LabeledPattern | null {
  return PATTERNS.find(({ regex }) => regex.test(input)) ?? null;
}

export const destructiveDetector: SafetyDetector = {
  id: "destructive_mass_action",
  priority: 10,

  supports(input: string): boolean {
    return findMatch(input) !== null;
  },

  detect(input: string): SafetyResult | null {
    const match = findMatch(input);
    if (match === null) return null;
    return {
      verdict: "block",
      reason: "destructive_mass_action",
      matchedPattern: match.label,
      note: match.note ?? DEFAULT_NOTE,
    };
  },
};
