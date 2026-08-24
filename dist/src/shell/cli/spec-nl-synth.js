/**
 * src/shell/cli/spec-nl-synth.ts
 *
 * S4 — Trust & Surface Integrity: WorkflowSpec NL synthesis.
 *
 * `loadWorkflowSpecFromFile` (and any test helper that mirrors it) calls this
 * module for every WorkflowSpec task that arrives with an NL `input` string
 * but no structured fields (no `operationType`, no `structuredReplace`,
 * no `command`, no `content`/`newPath`). The NL string is routed through the
 * single canonical NL parser — `normalizeNLToIR` — and the resulting IR
 * `Operation` is mapped to the WorkflowTaskSpec structured fields the
 * coordinator already understands.
 *
 * Why this exists (S4 / friction #44):
 *   Pre-S4, `WorkflowSpec.tasks[].input` was the ONLY NL surface in the
 *   system that did NOT route through `normalizeNLToIR`. The workflow
 *   coordinator's `isDeliverableTaskSpec` fell back to a separate legacy
 *   parser (`parseChange` + `hasDeterministicReplaceInput`) that knew
 *   `replace` / `change` / `create` / `rename` / `delete` but NOT
 *   `append` / `prepend` / `run`. That divergence is friction #44.
 *
 *   Post-S4 there is exactly one NL parser. WorkflowSpec NL gets normalized
 *   at spec-load time and the coordinator stops parsing strings entirely.
 *
 * Why this lives at the spec-load boundary, not in the coordinator:
 *   The coordinator's job is to execute structured tasks. NL parsing is a
 *   parse-stage concern that belongs at the input boundary — same boundary
 *   as `processNLInput` in `use-steady.ts` for `--prompt`/positional/stdin.
 *   A WorkflowSpec file is conceptually equivalent to those entry-layer
 *   surfaces, just persisted; its NL deserves the same parse-stage gate.
 *
 * Trust contract (S4 / R4 — uniform):
 *   `replace` requires an explicit occurrence clause. The same R4 rule
 *   that applies to `--prompt` etc. applies here. WorkflowSpec replace
 *   without `first occurrence` (or equivalent) returns a structured load
 *   error rather than silently defaulting. This is a deliberate breaking
 *   change in favor of trust consistency — see PR body for migration.
 *
 *   `replace` with non-first occurrence (`all occurrences`, `2nd
 *   occurrence`, etc.) is also rejected here because the existing
 *   `WorkflowTaskSpec.structuredReplace` does NOT carry an occurrence
 *   field — the executor would silently default to first. Rejecting
 *   non-first at synthesis time prevents that drift. Users who need
 *   non-first occurrence should use `--json` with the IR-shape replace op.
 *
 * Recovery parity (CLI/Web — P1):
 *   When normalization fails with `parse_error` (vague / unparseable NL),
 *   callers may pass the task through with raw `input` only. The
 *   coordinator routes those tasks to `skipped_by_intake` — matching the
 *   web UI's `/api/workflow/start` synthesis path in `server.ts`.
 *   Hard rejects (`ambiguous_match` for R4, non-first replace mapping
 *   failures, etc.) still fail closed at load time.
 */
import { normalizeNLToIR } from "../../input/nl-to-ir.js";
import { mapIROpToStructuredFields } from "./ir-to-spec-fields.js";
/**
 * Whether a failed synthesis may defer to coordinator intake recovery
 * (`skipped_by_intake`) instead of failing at spec-load time.
 *
 * Only normalize-stage `parse_error` is recovery-eligible. R4
 * (`ambiguous_match`) and IR→Spec mapping failures remain hard rejects.
 */
export function isNlRecoveryEligibleFailure(result) {
    return result.code === "parse_error";
}
// ─── Public API ──────────────────────────────────────────────────────────────
/**
 * Synthesize the structured `WorkflowTaskSpec` fields for a bare-NL task input.
 *
 * Returns `{ ok: true, fields }` on success — caller spreads `fields` into
 * the task object alongside `input`/`label`/`runtime`/`targetFiles`.
 *
 * Returns `{ ok: false, reason }` when the NL cannot be normalized or the
 * IR `Operation` cannot be expressed in the existing structured fields
 * (the only case for the latter is non-first replace occurrence, which
 * the existing `structuredReplace` shape does not carry).
 *
 * The caller decides the load-stage error code/message to wrap the reason
 * in. This module does not throw or mint error codes — that's the caller's
 * (`loadWorkflowSpecFromFile`) responsibility, so all run-spec-load errors
 * stay homogeneous in shape.
 */
export function synthesizeStructuredFieldsFromNL(input) {
    // Route through the single canonical NL parser. The "stdin" surface is
    // chosen because (a) WorkflowSpec is a non-interactive source group like
    // stdin, and (b) it preserves the `input` string verbatim in
    // `IR.source.raw` for the same diagnostic story the entry-layer surfaces
    // get. The choice has no effect on accept/reject behavior.
    const parsed = normalizeNLToIR(input, "stdin");
    if (parsed.kind === "error") {
        return {
            ok: false,
            reason: parsed.error.message,
            code: parsed.error.code,
        };
    }
    const op = parsed.ir.operations[0];
    if (!op) {
        // normalizeNLToIR's ok-result invariant guarantees one operation. This
        // branch is defensive only — it should be unreachable.
        return {
            ok: false,
            reason: "internal: NL normalizer returned an empty operations array",
        };
    }
    return mapIROpToStructuredFields(op);
}
//# sourceMappingURL=spec-nl-synth.js.map