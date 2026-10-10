/**
 * Presence-attribution helper (browser mirror).
 *
 * Mirrors `src/understand/interpretation/attribution.ts` -- the canonical
 * attribution DECISION used by the certification harness
 * (`scripts/cert-presence-mechanism.ts`). Keep in sync: the certified property
 * is that every present fact on the deterministic path is attributable to a named
 * mechanism (provision), and the UI must not diverge from the certificate.
 * (Same "browser mirror, keep in sync" pattern as `intent.ts`.)
 *
 * Authority: none. Rendering-only. This derives a display string from a present
 * fact + the raw request; it gates nothing and decides nothing.
 *
 * Governed by USESTEADY_PRESENCE_ATTRIBUTION_UI_IMPLEMENTATION_V1 (S1 + S2).
 */

import type { FsChange, WorkflowTaskSpec } from "../api/types.js";

// ─── Canonical decision (mirror of src attribution) ──────────────────────────

/** Normalize for containment: lowercase, drop quotes, collapse whitespace. */
export function normalizeForAttribution(s: string): string {
  return s.toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}

/** True iff the present fact's value traces to the literal request (provision). */
export function isProvisioned(value: string, input: string): boolean {
  const v = normalizeForAttribution(value);
  if (v.length === 0) return false;
  return normalizeForAttribution(input).includes(v);
}

// ─── Present-fact extraction (UI-specific shapes) ────────────────────────────

export type PresentFact = { readonly field: string; readonly value: string };

/** The string-valued present facts an FS operation puts in front of the user. */
export function presentFactsForFsOp(op: FsChange): PresentFact[] {
  switch (op.operationType) {
    case "create_dir":
      return [{ field: "directory", value: op.dirPath }];
    case "write_file":
      return [{ field: "file", value: op.filePath }];
    case "rename":
      return [
        { field: "from", value: op.filePath },
        { field: "to", value: op.newPath },
      ];
    case "delete_file":
      return [{ field: "path", value: op.filePath }];
  }
}

/**
 * Present facts for a non-FS `replace` step, parsed from the raw input using the
 * same quoted patterns as `describeNonFsStep` (intent.ts). Returns the find /
 * replace / file values when extractable, else falls back to targetFiles. An
 * empty array means there is no concretely-named present fact (the System-will
 * line was a generic fallback) -- the caller treats that as unattributed.
 */
export function presentFactsForReplace(spec: WorkflowTaskSpec): PresentFact[] {
  const raw = spec.input.trim();

  const m =
    raw.match(/^replace\s+"([^"]+)"\s+with\s+"([^"]+)"\s+in\s+(.+)$/i) ??
    raw.match(/^replace\s+'([^']+)'\s+with\s+'([^']+)'\s+in\s+(.+)$/i) ??
    raw.match(/^change\s+"([^"]+)"\s+to\s+"([^"]+)"\s+in\s+(.+)$/i) ??
    raw.match(/^change\s+'([^']+)'\s+to\s+'([^']+)'\s+in\s+(.+)$/i);

  if (m) {
    const [, find, replacement, filePart] = m;
    const file = spec.targetFiles?.[0] ?? filePart?.trim() ?? "";
    return [
      { field: "find", value: find ?? "" },
      { field: "replace", value: replacement ?? "" },
      { field: "file", value: file },
    ];
  }

  if (spec.targetFiles && spec.targetFiles.length > 0) {
    return spec.targetFiles.map((f) => ({ field: "file", value: f }));
  }

  return [];
}

// ─── Attribution line (the rendered output) ──────────────────────────────────

export type AttributionLine = {
  readonly field: string;
  readonly value: string;
  readonly attributed: boolean;
  /** The subordinate text shown under "System will" for this fact. */
  readonly text: string;
};

export const UNATTRIBUTED_TEXT = "source unattributed";

/** Build the attribution line for a single present fact against the raw input. */
export function attributionLineFor(fact: PresentFact, rawInput: string): AttributionLine {
  const attributed = isProvisioned(fact.value, rawInput);
  return {
    field: fact.field,
    value: fact.value,
    attributed,
    text: attributed
      ? `present because "${fact.value}" appears in your request`
      : UNATTRIBUTED_TEXT,
  };
}

/** Build attribution lines for all present facts of a step. */
export function attributionLines(
  facts: readonly PresentFact[],
  rawInput: string,
): AttributionLine[] {
  return facts.map((f) => attributionLineFor(f, rawInput));
}
