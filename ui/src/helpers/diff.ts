/**
 * Diff helpers for USESTEADY_REAL_DIFF_V1.
 *
 * Slice 1 scope: new-file (write_file) diffs only. The "before" is empty (the
 * executor refuses write_file when the target already exists), so the full file
 * content is rendered as an all-added hunk. This is truthful with zero disk
 * access. See docs/product/USESTEADY_REAL_DIFF_V1.md.
 */

import type { DiffHunk } from "../components/ui/DiffView.js";

/**
 * Build an all-added diff hunk for a brand-new file from its full content.
 *
 * - Empty content -> [] (render nothing; never fabricate a diff for an empty file).
 * - A single trailing newline is treated as the file's terminating newline, not
 *   an extra blank line, so it is not shown as a phantom added line.
 *
 * Truthfulness: every returned line is genuinely part of the new file's content.
 */
export function newFileHunks(content: string): DiffHunk[] {
  if (content === "") return [];

  const lines = content.split("\n");
  // Drop the trailing empty element produced by a terminating newline.
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return [
    {
      header: `@@ -0,0 +1,${lines.length} @@`,
      lines: lines.map((line) => ({ kind: "added" as const, content: line })),
    },
  ];
}
