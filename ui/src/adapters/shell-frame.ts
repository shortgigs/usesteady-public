/**
 * Phase 11A-Web: ShellFrame → view model adapter.
 *
 * Translates a raw ShellFrame (array of text lines + prompt) into structured
 * view model objects that React components consume as clean props.
 *
 * UI-W1: React renders frozen contract outputs; it does not reinterpret them.
 * UI-W3: If a frame has no prompt, the view model marks it read-only.
 */

import type { ShellFrame, ShellPrompt } from "../api/types.js";
import { extractDualDisplay }           from "../helpers/interpretation.js";
import { extractFailureExplanation }    from "../helpers/failure.js";

// ─── Output types ─────────────────────────────────────────────────────────────

export type FrameSection = {
  /** Section heading, if the line looks like a heading (e.g. "── Tasks ──") */
  readonly heading?: string;
  /** Body lines (non-heading, non-empty) */
  readonly lines:    readonly string[];
};

export type FrameViewModel = {
  /** Headline (first non-empty line). */
  readonly headline: string;
  /** Body sections grouped by heading-style separator lines. */
  readonly sections: readonly FrameSection[];
  /** Dual-display extracted from "You asked:" / "System understood:" lines. */
  readonly dual:     { rawInput: string; understood: string | null } | null;
  /** Failure explanation extracted from "Failure:" lines. */
  readonly failure:  { what: string; action: string } | null;
  /** Prompt from the frame, or null if terminal. */
  readonly prompt:   ShellPrompt | null;
  /** True when there is no prompt — frame is a read-only terminal state. */
  readonly readonly: boolean;
  /** All raw lines (for fallback rendering). */
  readonly raw:      readonly string[];
};

// ─── Heading detection ────────────────────────────────────────────────────────

const SEPARATOR_RE = /^[\s─\-=]{3,}/;
const HEADING_RE   = /^[A-Z].*:?\s*$/;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  return SEPARATOR_RE.test(t) || HEADING_RE.test(t);
}

// ─── Adapter function ─────────────────────────────────────────────────────────

export function shellFrameToViewModel(frame: ShellFrame): FrameViewModel {
  const raw = frame.lines;
  const prompt: ShellPrompt | null = frame.prompt ?? null;

  // headline: first non-empty line
  const headline = raw.find(l => l.trim().length > 0) ?? "";

  // body lines: everything after the headline
  const bodyLines = raw.slice(raw.indexOf(headline) + 1).filter(l => l.trim());

  // group into sections by heading-style lines
  const sections: FrameSection[] = [];
  let current: { heading?: string; lines: string[] } = { lines: [] };

  for (const line of bodyLines) {
    if (isHeadingLine(line)) {
      if (current.lines.length > 0 || current.heading) {
        sections.push({ ...current, lines: current.lines });
      }
      current = { heading: line.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0 || current.heading) {
    sections.push({ ...current, lines: current.lines });
  }

  return {
    headline,
    sections,
    dual:     extractDualDisplay(raw),
    failure:  extractFailureExplanation(raw),
    prompt,
    readonly: prompt === null,
    raw,
  };
}
