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
 * Build the catalog. Pure. Deterministic. Patterns are in a fixed order
 * (json, batch, run) which matches the operator's typical progression.
 */
export declare function buildInvocationPatternsCatalog(): InvocationPatternsCatalog;
/**
 * Render the catalog as a single-line JSON string, terminated by exactly
 * one newline. Key order is fixed by the InvocationPatternEntry shape
 * above, which is constructed in a fixed order in
 * buildInvocationPatternsCatalog. JSON.stringify preserves insertion
 * order for string keys per the ECMAScript spec.
 */
export declare function renderExamplesJson(): string;
/**
 * Render the catalog as a human-readable text block. Bytes are
 * identical across runs for a given build.
 */
export declare function renderExamplesText(): string;
//# sourceMappingURL=examples.d.ts.map