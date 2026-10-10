/**
 * DiffView — shared primitive for rendering unified-diff hunks.
 *
 * Design rules:
 *   - Uses STATUS_TONE from helpers/status-tone.ts for semantic colors:
 *       added   → success (emerald)
 *       removed → danger  (red)
 *       context → neutral (gray)
 *   - Dark-theme base (gray-950/900), font-mono for all content lines.
 *   - Accessible: <code> block with aria-label, line content via <span>.
 *   - Small, stable API: pass `hunks` (array of DiffHunk), each hunk has an
 *     optional header string and an array of DiffLine objects.
 *
 * TRUTHFULNESS CONSTRAINT: Only render this component when the diff is derived
 * from data the server already knows (e.g. new file creation, known before +
 * after text). Never call this component with fabricated or speculative lines.
 * See AGENTS.md: 'Do NOT use "No diff preview before execution" outside of
 * isRuntimeConfigFile() branches' and the broader truthfulness rules.
 *
 * Usage:
 *   <DiffView
 *     hunks={[{
 *       header: "@@ -0,0 +1,3 @@",
 *       lines: [
 *         { kind: "added",   content: "export function foo() {" },
 *         { kind: "added",   content: "  return 42;" },
 *         { kind: "added",   content: "}" },
 *       ],
 *     }]}
 *     aria-label="New file content"
 *   />
 */

import { STATUS_TONE } from "../../helpers/status-tone.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DiffLineKind = "added" | "removed" | "context";

export type DiffLine = {
  /** Kind governs gutter prefix (+/-/ ) and line color. */
  kind: DiffLineKind;
  /** Raw line content (without the leading +/-/space character). */
  content: string;
};

export type DiffHunk = {
  /**
   * Optional unified-diff range header, e.g. "@@ -1,5 +1,6 @@".
   * Displayed in a subdued mono row when present.
   */
  header?: string;
  lines: DiffLine[];
};

type Props = {
  hunks: DiffHunk[];
  /** Accessible label for the code block. */
  "aria-label"?: string;
};

// ─── Line rendering tokens ────────────────────────────────────────────────────

const LINE_BG: Record<DiffLineKind, string> = {
  added:   "bg-emerald-950/40",
  removed: "bg-red-950/30",
  context: "",
};

const LINE_TEXT: Record<DiffLineKind, string> = {
  added:   STATUS_TONE.success.text,   // text-emerald-300
  removed: STATUS_TONE.danger.text,    // text-red-300
  context: "text-gray-500",
};

const GUTTER_PREFIX: Record<DiffLineKind, string> = {
  added:   "+",
  removed: "-",
  context: " ",
};

const GUTTER_COLOR: Record<DiffLineKind, string> = {
  added:   STATUS_TONE.success.text,
  removed: STATUS_TONE.danger.text,
  context: "text-gray-700",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function DiffView({ hunks, "aria-label": ariaLabel }: Props) {
  if (hunks.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden"
      role="region"
      aria-label={ariaLabel ?? "Diff view"}
    >
      <code className="block text-[11px] font-mono leading-5">
        {hunks.map((hunk, hi) => (
          <div key={hi}>
            {/* Hunk range header */}
            {hunk.header !== undefined && (
              <div className="px-3 py-1 bg-gray-900/60 text-[10px] text-gray-600 border-b border-gray-800/80 select-none">
                {hunk.header}
              </div>
            )}

            {/* Lines */}
            {hunk.lines.map((line, li) => (
              <div
                key={li}
                className={`flex gap-0 ${LINE_BG[line.kind]}`}
              >
                {/* Gutter */}
                <span
                  className={`shrink-0 w-5 pl-2 select-none ${GUTTER_COLOR[line.kind]}`}
                  aria-hidden="true"
                >
                  {GUTTER_PREFIX[line.kind]}
                </span>
                {/* Content */}
                <span className={`flex-1 pr-3 py-0 whitespace-pre overflow-x-auto ${LINE_TEXT[line.kind]}`}>
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        ))}
      </code>
    </div>
  );
}
