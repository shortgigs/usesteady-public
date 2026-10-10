/**
 * usesteady examples -- read-only reference for the three workflow
 * invocation shapes the CLI accepts.
 *
 * Pure module. No I/O, no process.exit, no execution. Importing this
 * module cannot read stdin, write the filesystem, spawn a process, or
 * talk to a model. It exists to render a single source of truth for the
 * question "which command takes which JSON shape?" -- the highest-leverage
 * onboarding friction surfaced by the alpha.56 walkthrough.
 *
 * Source of truth alignment:
 *   - inline single op       -> `--json '<op>'`            (consumed by
 *                                processJsonInput in use-steady.ts)
 *   - op array               -> `batch <file>`             (consumed by
 *                                processJsonInput in use-steady.ts via
 *                                the batch dispatcher branch)
 *   - WorkflowSpec object    -> `run <file>`               (consumed by
 *                                loadWorkflowSpecFromFile in main.ts; the
 *                                same function also auto-wraps a single
 *                                JSON op or an op array, but the
 *                                recommended command for each shape is
 *                                the one named above)
 *
 * The minimal JSON shown for each pattern is byte-identical to the
 * examples surfaced elsewhere:
 *   - `--json` op example reuses the same fields as the HELP_TEXT
 *     "JSON op schema" block in use-steady.ts and the per-op example in
 *     `usesteady capabilities` (src/shell/cli/capabilities.ts).
 *   - `batch` array example wraps the same op shape into an array.
 *   - `run` WorkflowSpec example uses the same fields the
 *     RUN_SPEC_ACCEPTED_SHAPES_MESSAGE in main.ts names.
 *
 * Design: docs/product/useability-and-guided-execution-track.md (Product
 * Capability Track) -- workflow invocation ergonomics. Surface added in
 * the alpha.57 implementation slice.
 *
 * Determinism: every exported function is pure and order-stable.
 *   - patterns are returned in a fixed order (json, batch, run) -- that
 *     order matches the operator's progression from "smallest one-off"
 *     to "saved batch" to "full workflow with NL inputs";
 *   - JSON output is single-line with stable key order
 *     (patterns -> [{id, command, when_to_use, minimal_example}]);
 *   - text output bytes are identical across runs for a given build.
 *
 * Authority:
 *   - This module does not interact with the planner, the safety gate,
 *     the executor, the model-insertion path, or any approval surface.
 *   - The output is informational. Nothing in this catalog can be
 *     approved or executed. To actually run a workflow, the operator
 *     copies one of the minimal examples, customizes it, and runs the
 *     matching command through the existing approval flow.
 *   - No hidden coercion between shapes, no automatic envelope
 *     conversion, no AI generation, no semantic interpretation.
 */

/**
 * Public catalog entry shape. Stable; this is the JSON output schema.
 */
export type InvocationPatternEntry = {
  /** Stable machine-readable id. */
  readonly id: "json" | "batch" | "run";
  /** The exact command form the operator should type. */
  readonly command: string;
  /** One-line statement of the JSON shape the command consumes. */
  readonly shape: string;
  /** One-line "when to use this" guidance. */
  readonly when_to_use: string;
  /** Minimal valid JSON for the pattern, ready to copy. */
  readonly minimal_example: unknown;
};

/**
 * Top-level catalog shape. Stable; the JSON output is exactly this.
 */
export type InvocationPatternsCatalog = {
  readonly patterns: readonly InvocationPatternEntry[];
};

/**
 * Minimal JSON shapes per pattern. Field names match what
 * `jsonOpToIROperation` (src/input/json-to-ir.ts) and
 * `loadWorkflowSpecFromFile` (src/shell/cli/main.ts) actually accept.
 *
 * These are intentionally the smallest possible valid payloads so an
 * operator copying one can run it immediately after customizing the
 * file path and the appended text.
 */
const MINIMAL_JSON_EXAMPLE: Readonly<Record<string, unknown>> = Object.freeze({
  type: "append",
  file: "NOTES.md",
  to:   "hello from usesteady\n",
});

const MINIMAL_BATCH_EXAMPLE: readonly Readonly<Record<string, unknown>>[] = Object.freeze([
  Object.freeze({ type: "append", file: "NOTES.md", to: "hello from usesteady\n" }),
  Object.freeze({ type: "rename", from: "todo.txt", to: "todo-2026.txt" }),
]);

const MINIMAL_RUN_EXAMPLE: Readonly<Record<string, unknown>> = Object.freeze({
  name:  "first-workflow",
  tasks: Object.freeze([
    Object.freeze({
      input:         "Append hello to NOTES.md",
      runtime:       "cursor",
      operationType: "append_file",
      targetFiles:   Object.freeze(["NOTES.md"]),
      content:       "hello from usesteady\n",
    }),
  ]),
});

/**
 * Build the catalog. Pure. Deterministic. Patterns are in a fixed order
 * (json, batch, run) which matches the operator's typical progression.
 */
export function buildInvocationPatternsCatalog(): InvocationPatternsCatalog {
  const patterns: InvocationPatternEntry[] = [
    Object.freeze({
      id:              "json",
      command:         "usesteady --json '<inline op>' --yes",
      shape:           "a single JSON op object",
      when_to_use:     "Use --json for one inline single operation. No file needed; the JSON is the argument.",
      minimal_example: MINIMAL_JSON_EXAMPLE,
    }),
    Object.freeze({
      id:              "batch",
      command:         "usesteady batch <file> --yes",
      shape:           "a JSON array of op objects",
      when_to_use:     "Use batch <file> for a saved array of operations. The file is a JSON array; each element is the same shape --json accepts.",
      minimal_example: MINIMAL_BATCH_EXAMPLE,
    }),
    Object.freeze({
      id:              "run",
      command:         "usesteady run <file>",
      shape:           "a WorkflowSpec object with name + tasks (also auto-wraps a single op or an op array)",
      when_to_use:     "Use run <file> for a full WorkflowSpec with labeled tasks, runtime hints, and NL inputs. The same command also accepts the json-op and batch shapes (auto-wrapped) for convenience.",
      minimal_example: MINIMAL_RUN_EXAMPLE,
    }),
  ];
  return Object.freeze({ patterns: Object.freeze(patterns) });
}

/**
 * Render the catalog as a single-line JSON string, terminated by exactly
 * one newline. Key order is fixed by the InvocationPatternEntry shape
 * above, which is constructed in a fixed order in
 * buildInvocationPatternsCatalog. JSON.stringify preserves insertion
 * order for string keys per the ECMAScript spec.
 */
export function renderExamplesJson(): string {
  return JSON.stringify(buildInvocationPatternsCatalog()) + "\n";
}

/**
 * Render the catalog as a human-readable text block. Bytes are
 * identical across runs for a given build.
 */
export function renderExamplesText(): string {
  const catalog = buildInvocationPatternsCatalog();
  const lines: string[] = [];
  lines.push("");
  lines.push("  UseSteady workflow invocation shapes:");
  lines.push("");
  lines.push("  There are three ways to invoke a workflow. Pick the one that");
  lines.push("  matches the JSON shape you have on hand. Each is approved");
  lines.push("  through the same SYSTEM WILL flow before anything runs.");
  lines.push("");
  for (const entry of catalog.patterns) {
    lines.push(`  ${entry.id}`);
    lines.push(`      Command:     ${entry.command}`);
    lines.push(`      Shape:       ${entry.shape}`);
    lines.push(`      When to use: ${entry.when_to_use}`);
    lines.push(`      Minimal example:`);
    const exampleJson = JSON.stringify(entry.minimal_example, null, 2);
    for (const line of exampleJson.split("\n")) {
      lines.push(`          ${line}`);
    }
    lines.push("");
  }
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Quick rule of thumb");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("      Use --json for one inline op.");
  lines.push("      Use batch <file> for an array of ops.");
  lines.push("      Use run <file> for a WorkflowSpec object.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  See also");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("      usesteady quickstart          First 5 minutes end-to-end");
  lines.push("      usesteady capabilities        Full catalog of op types");
  lines.push("      usesteady templates           Safe starter workflows");
  lines.push("      usesteady help                Complete CLI usage");
  lines.push("");
  lines.push("  Examples is read-only. Running this command does not execute");
  lines.push("  anything; it only prints the patterns above.");
  lines.push("");
  return lines.join("\n");
}
