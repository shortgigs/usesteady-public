/**
 * UI intent helper — thin wrapper over the server-side intent normalizer shapes.
 *
 * The canonical normalizer logic lives in:
 *   src/understand/interpretation/intent.ts
 *
 * This module provides:
 *   1. A browser-safe ParsedIntent type mirror
 *   2. describeFsOp() — "SYSTEM WILL:" display text for FsChange ops
 *   3. SUPPORTED_FORMATS — the example formats shown in failure cards
 */

import type { FsChange, WorkflowTaskSpec } from "../api/types.js";

// ─── ParsedIntent (browser mirror) ───────────────────────────────────────────
// Mirrors src/understand/interpretation/intent.ts — must be kept in sync.

export type ParsedIntent =
  | { readonly kind: "create_dir";  readonly path: string }
  | { readonly kind: "create_file"; readonly path: string; readonly content?: string }
  | { readonly kind: "rename";      readonly from: string; readonly to: string }
  | { readonly kind: "delete";      readonly path: string }
  | { readonly kind: "replace";     readonly find: string; readonly replace: string; readonly file: string };

// ─── describeFsOp ─────────────────────────────────────────────────────────────

/**
 * Returns the "SYSTEM WILL:" display line for a FsChange operation.
 * Used in ApprovalFrame's FsOpCard.
 *
 * Matches the server-side describeIntent() output format.
 */
export function describeFsOp(op: FsChange): string {
  switch (op.operationType) {
    case "create_dir":
      return `Create directory: ./${op.approvedEffective?.rel ?? op.dirPath}`;
    case "write_file":
      return `Create file: ./${op.approvedEffective?.rel ?? op.filePath}`;
    case "rename":
      return `Rename path: ${op.approvedEffectiveFrom?.rel ?? op.filePath}  →  ${op.approvedEffectiveTo?.rel ?? op.newPath}`;
    case "delete_file":
      return `Delete path: ./${op.approvedEffective?.rel ?? op.filePath}`;
  }
}

// ─── describeNonFsStep ────────────────────────────────────────────────────────

/**
 * Produces a concrete SYSTEM WILL description for non-FS steps shown in
 * ApprovalFrame when there is no FsChange (run.currentFsOp is absent).
 *
 * Returns a string for known/parseable cases, or null when the step is a
 * fully runtime-delegated task (caller should show a "forwarding" message).
 *
 * Covers:
 *   - replace operations: parses the raw input for find/replace/file tokens.
 *   - all other operationType values fall through to null (FS ops are handled
 *     separately by FsOpCard and should never reach this function).
 */
export function describeNonFsStep(spec: WorkflowTaskSpec): string | null {
  // Allow detection even when operationType is not pre-set (e.g. web UI specs)
  if (spec.operationType !== undefined && spec.operationType !== "replace") return null;

  const raw = spec.input.trim();

  // canonical: replace "find" with "replace" in file
  const canonical =
    raw.match(/^replace\s+"([^"]+)"\s+with\s+"([^"]+)"\s+in\s+(.+)$/i) ??
    raw.match(/^replace\s+'([^']+)'\s+with\s+'([^']+)'\s+in\s+(.+)$/i);

  if (canonical) {
    const [, find, replacement, filePart] = canonical;
    const file = spec.targetFiles?.[0] ?? filePart?.trim();
    return `Replace "${find}" → "${replacement}" in ${file}`;
  }

  // change "find" to "replace" in file
  const natural =
    raw.match(/^change\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+(.+)$/i) ??
    raw.match(/^change\s+'([^']+)'\s+to\s+'([^']+)'\s+in\s+(.+)$/i);

  if (natural) {
    const [, find, replacement, filePart] = natural;
    const file = spec.targetFiles?.[0] ?? filePart?.trim();
    return `Replace "${find}" → "${replacement}" in ${file}`;
  }

  // has targetFiles but unparseable tokens — still concrete enough
  if (spec.targetFiles && spec.targetFiles.length > 0) {
    return `Replace text in: ${spec.targetFiles.join(", ")}`;
  }

  // replace op but no file info extractable
  return "Replace text in specified file";
}

// ─── runtimeSystemWill ────────────────────────────────────────────────────────

/**
 * Returns the SYSTEM WILL description for runtime-delegated steps (no FsChange,
 * no parseable operationType). These steps are forwarded to an AI runtime and
 * may produce file changes that require a subsequent approval step.
 */
export function runtimeSystemWill(runtime: WorkflowTaskSpec["runtime"]): string {
  const label = runtime === "claude" ? "Claude AI" : "Cursor AI";
  return `Forward to ${label} for execution — no direct filesystem change in this step.`;
}

// ─── SUPPORTED_FORMATS ───────────────────────────────────────────────────────

/**
 * Canonical example formats shown in failure cards when a task is unsupported.
 * Kept here so the failure card and any onboarding surfaces stay in sync.
 */
/**
 * Curated 3-example subset shown in the "COULD NOT UNDERSTAND" recovery card.
 * Covers the three most common operation types so the list stays scannable.
 */
export const RECOVERY_FORMATS: readonly string[] = [
  "mkdir components",
  "create file README.md",
  "rename old.ts to new.ts",
];

// ─── guessParseable ───────────────────────────────────────────────────────────

/**
 * Lightweight browser-side check: does this input look like something the
 * server-side intent parser can handle for cursor (local-edit) tasks?
 *
 * Used for pre-flight validation in WorkflowBuilder — warns before execution,
 * not after. Errs on the side of false-negatives (returns true when uncertain)
 * to avoid blocking valid inputs that the server may accept.
 *
 * Only applies to runtime="cursor" tasks. Claude tasks skip this check.
 */
export function guessParseable(input: string): boolean {
  const t = input.trim();
  if (!t) return false;

  // create dir
  if (/^(create|make|mkdir|new|init(ialize)?|scaffold|generate|setup|spin\s+up)\s+(a\s+)?(new\s+)?(folder|directory|dir)\b/i.test(t)) return true;
  if (/^mkdir\s+\S/i.test(t)) return true;
  if (/^(add|new)\s+(directory|folder|dir)\b/i.test(t)) return true;

  // create file
  if (/^(create|make|touch|add|write)\s+(a\s+)?(new\s+)?(empty\s+)?(file)\b/i.test(t)) return true;
  if (/^touch\s+\S/i.test(t)) return true;
  if (/^new\s+file\s+\S/i.test(t)) return true;

  // rename / move
  if (/^(rename|move|mv)\s+\S/i.test(t)) return true;

  // delete / remove
  if (/^(delete|remove|rm)\s+(file\s+|folder\s+|dir(ectory)?\s+|the\s+)?\S/i.test(t)) return true;

  // replace / change "X" with/to "Y" in <file>
  if (/^(replace|change)\s+["'].+["']\s+(with|to)\s+["'].+["']\s+in\s+\S/i.test(t)) return true;
  if (/^(replace|change)\s+\S.+\s+(with|to)\s+\S.+\s+in\s+\S+\.\w+/i.test(t)) return true;

  return false;
}

// ─── suggestRewrite ───────────────────────────────────────────────────────────

/**
 * Maps common unsupported natural-language patterns to the closest supported
 * format. Returns null when no close match can be safely inferred.
 *
 * Used in two places:
 *   1. WorkflowBuilder pre-flight warning (before execution)
 *   2. TerminalFrame skipped_by_intake recovery card (after execution)
 */
export function suggestRewrite(input: string): string | null {
  const t     = input.trim();
  const lower = t.toLowerCase();

  // "keep only X in file" / "keep only X and remove ..."
  if (/\bkeep\s+only\b/i.test(lower)) {
    const fileMatch = t.match(/\bin\s+(\S+\.\w+)/i);
    const file = fileMatch?.[1] ?? "<file>";
    return `replace entire content of ${file} with "<new content>"`;
  }

  // "find <file> in <folder>" / "locate <file>"
  if (/^(find|locate|search\s+for)\b/i.test(lower)) {
    return `Specify the file path directly — e.g. rename <folder>/<file> to <new>`;
  }

  // "remove lines matching / containing X"
  if (/^remove\s+lines?\s+(matching|containing|with)\b/i.test(lower)) {
    const match = t.match(/(?:matching|containing|with)\s+["']?([^"'\n]+)["']?/i);
    const pattern = match?.[1]?.trim() ?? "...";
    return `replace "${pattern}" with "" in <file>`;
  }

  // "add X to the top/bottom of file"
  if (/\b(top|bottom|start|end|beginning)\s+of\b/i.test(lower) && /\bof\s+\S+\.\w+/i.test(lower)) {
    return `Not directly supported yet — try: replace "first line" with "new line\nfirst line" in <file>`;
  }

  // "change X to Y" with no file
  if (/^change\s+.+\s+to\s+/i.test(lower) && !/\bin\s+\S+\.\w+/i.test(lower)) {
    return `Specify a file: change "old" to "new" in <file>`;
  }

  // "modify / update / edit / fix" — too vague
  if (/^(modify|update|edit|fix|adjust|rewrite)\s+/i.test(lower)) {
    return `Try: replace "old text" with "new text" in <file>`;
  }

  return null;
}

export const SUPPORTED_FORMATS: readonly string[] = [
  "create folder components",
  "create a test folder",
  "mkdir src/utils",
  "create file README.md",
  "touch src/index.ts",
  "rename old.ts to new.ts",
  "mv Button.tsx PrimaryButton.tsx",
  "delete file src/unused.ts",
  "delete src/old.ts",
  'replace "x" with "y" in src/App.tsx',
  'change "Submit" to "Send" in Form.tsx',
];
