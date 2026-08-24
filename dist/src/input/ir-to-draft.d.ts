/**
 * src/input/ir-to-draft.ts
 *
 * M2 — transitional IR → DraftTask shim.
 *
 * The existing CLI pipeline downstream of `processJsonInput` consumes
 * `DraftTask[]` (safety gate, preview formatter, approval flow,
 * `draftTaskToInput`, `draftTaskToSpecTask`, the workflow executor). M2's
 * scope is "produce IR for --json + batch without changing public behavior."
 *
 * This shim makes that possible: the JSON adapter produces IR, this shim
 * maps IR back to the exact `DraftTask` shape the legacy `jsonOpToDraftTask`
 * produced for the same input. Downstream code is untouched.
 *
 * This is a transitional file. M3 / M5 / M6 will progressively delete it as
 * downstream consumers migrate to read IR directly:
 *
 *   - M3 adds the feasibility validator that consumes IR (this shim still
 *     used for the executor leg).
 *   - M5 introduces SessionController and its own IR-aware execution path.
 *   - M6 deletes the legacy DraftTask layer entirely; this file goes with it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Identical-output guarantee
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * For every IR `Operation` produced by `jsonOpToIROperation`, this function
 * MUST return a `DraftTask` that is byte-equivalent to what the legacy
 * `jsonOpToDraftTask` produced for the same source JSON op. The
 * `tests/input/json-to-ir.identical-behavior.test.ts` file verifies this on
 * every accepted op shape.
 *
 * Specifically: action, from, to, file, and rawText must all match the
 * legacy output character-for-character. The IR carries one extra field
 * (`replace.args.occurrence`) that the legacy DraftTask does not have —
 * that field is dropped here and is not visible to any downstream consumer
 * in M2.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  `create_dir` handling
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Post-alpha.47 contract repair: `create_dir` is now a first-class op on
 * the public --json / batch surface, so `jsonOpToIROperation` CAN emit it.
 * However, the workflow `DraftTask.action` enum still has no `create_dir`
 * variant, so this shim still throws on `create_dir`. The throw is
 * unreachable in practice because `processJsonInput` (in
 * `src/shell/cli/use-steady.ts`) special-cases `op.type === "create_dir"`
 * BEFORE calling this shim and synthesizes the workflow `SpecTask`
 * directly with `operationType: "create_dir"`. The throw remains as a
 * defensive guard: any future code path that funnels create_dir through
 * the draft-task layer instead of the bypass branch will fail loudly at
 * the call site rather than silently produce a confusing DraftTask.
 */
import type { Operation } from "./ir.js";
import type { DraftTask } from "../shell/cli/draft/intent-to-tasks.js";
export declare function irOperationToJsonDraftTask(op: Operation): DraftTask;
//# sourceMappingURL=ir-to-draft.d.ts.map