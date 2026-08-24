/**
 * Silent Guidance Templates.
 *
 * Maps each SilentGuidanceMode to a set of generic, domain-appropriate
 * CompletionNextStep entries.  These replace the code-patch default
 * for bridge-silent flows.
 *
 * ── Template contracts ────────────────────────────────────────────────────────
 *
 *   - Every template has exactly 3 steps (read_first, use_exact_format,
 *     add_missing_field) — the same structural shape as the code-patch default.
 *   - No template invents specifics (file names, tool names, table names, etc.).
 *   - No template implies executability.  All remain in guide mode territory.
 *   - Templates use angle-bracket placeholders for values the user must supply.
 *
 * ── Why 3 steps ──────────────────────────────────────────────────────────────
 *
 *   read_first       — orients the user: gather information before acting
 *   use_exact_format — shows the deterministic format to express the change
 *   add_missing_field — names what the user must provide to make it actionable
 */
// ── Templates ──────────────────────────────────────────────────────────────────
const INVESTIGATION_STEPS = [
    {
        type: "read_first",
        label: "Identify where the issue occurs and gather observable evidence before making any change.",
    },
    {
        type: "use_exact_format",
        label: "Once you have identified the specific change, state the file, the exact current value, and the new value.",
    },
    {
        type: "add_missing_field",
        label: "Provide the exact symptom, test name, or failure condition so the change can be targeted.",
    },
];
const OPERATION_STEPS = [
    {
        type: "read_first",
        label: "Identify the specific tool, service, or system this operation applies to.",
    },
    {
        type: "use_exact_format",
        label: "Use: run <command>  or  specify the config file and the exact key and value to change.",
    },
    {
        type: "add_missing_field",
        label: "Specify what it acts on (service name, table, environment) and what the expected outcome is.",
    },
];
const CONTENT_ITERATION_STEPS = [
    {
        type: "read_first",
        label: "Open the file in your editor to find the exact current text you want to change.",
    },
    {
        type: "use_exact_format",
        label: 'Apply the change: replace "<current text>" with "<new text>" in "<file>"',
    },
    {
        type: "add_missing_field",
        label: "Provide the specific new wording or content you want to use.",
    },
];
const CODE_PATCH_STEPS = [
    {
        type: "read_first",
        label: "Open the relevant file first to find the exact text you want to change.",
    },
    {
        type: "use_exact_format",
        label: 'Apply the change: replace "<old>" with "<new>" in "<file>"',
    },
    {
        type: "add_missing_field",
        label: "Specify the exact file path, old value, and new value.",
    },
];
const UNKNOWN_STEPS = [
    {
        type: "read_first",
        label: "Break this request into one specific file change before proceeding.",
    },
    {
        type: "use_exact_format",
        // Governance: lists every op in OPERATION_REGISTRY exactly once.
        // tests/governance/input-surface-integrity.test.ts asserts this.
        label: 'Supported formats: replace "<old>" with "<new>" in "<file>"  |  append "<text>" to <file>  |  prepend "<text>" to <file>  |  rename <old> to <new>  |  create file <path>  |  mkdir <path>  |  delete file <path>  |  run <command>',
    },
    {
        type: "add_missing_field",
        label: "Specify the exact file, value, or target this request applies to.",
    },
];
/**
 * Boundary — request describes multi-step feature work, architectural changes,
 * or tasks outside UseSteady's eight supported operations.
 *
 * These steps tell the user what IS supported instead of pointing back at
 * a generic code-patch template that would be misleading. Governance
 * (tests/governance/input-surface-integrity.test.ts) requires every op in
 * OPERATION_REGISTRY to appear at least once across these labels. The
 * 3-step structural contract (see module header) is preserved by packing
 * the eight ops into the three labels rather than expanding row count.
 */
const BOUNDARY_STEPS = [
    {
        type: "use_exact_format",
        label: 'Supported (edit text): replace "<old>" with "<new>" in <file>  |  append "<text>" to <file>  |  prepend "<text>" to <file>',
    },
    {
        type: "use_exact_format",
        label: "Supported (filesystem): rename <old> to <new>  |  create file <path>  |  mkdir <path>  |  delete file <path>",
    },
    {
        type: "use_exact_format",
        label: "Supported (commands): run <command>",
    },
];
// ── Lookup ──────────────────────────────────────────────────────────────────────
/**
 * Return the generic next-step template for a given silent guidance mode.
 *
 * Returns a read-only array with exactly 3 steps.
 * The array is a module-level constant — no allocation on each call.
 */
export function getSilentGuidanceSteps(mode) {
    switch (mode) {
        case "investigation": return INVESTIGATION_STEPS;
        case "operation": return OPERATION_STEPS;
        case "content_iteration": return CONTENT_ITERATION_STEPS;
        case "code_patch": return CODE_PATCH_STEPS;
        case "boundary": return BOUNDARY_STEPS;
        case "unknown": return UNKNOWN_STEPS;
    }
}
//# sourceMappingURL=templates.js.map