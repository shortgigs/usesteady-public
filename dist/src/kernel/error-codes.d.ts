/**
 * src/kernel/error-codes.ts
 *
 * Kernel v1 — PR-K2 (normalized final CLI error codes)
 * -----------------------------------------------------------------------------
 *
 * A single closed enum of every error code the final CLI surface is allowed
 * to emit, plus a pure helper that turns whatever upstream emission sites
 * produced into one of those codes (or `null` on success).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  What this module owns (locked in K2 audit)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  D1 — Public shape is UNCHANGED. `KernelResult.error` stays `string | null`
 *       and `--output json` keeps `error: string | null`. This file is the
 *       internal choke point; it does NOT change the exported shape.
 *
 *  D2 — ONE closed enum, four tiers merged:
 *         • adapter-layer     (cursor FS-op + session path; src/cursor/types.ts
 *                              CursorExecutionErrorCode + src/cursor/adapters/*)
 *         • CLI-layer         (use-steady.ts inline literals + HELP_TEXT
 *                              documented codes)
 *         • consensus         (claude refused_due_to_execution_error on
 *                              consensus policy; coordinator.ts:1086-1091)
 *         • defensive         (`unknown` — terminal fallback only)
 *
 *  D3 — `unknown` is a TERMINAL defensive fallback, not a silent catch-all.
 *       It is returned ONLY when a raw code reaches the normalizer that is
 *       either empty/whitespace OR not in the canonical enum. Known emission
 *       sites continue to declare their own code; the normalizer must not
 *       collapse real codes into `unknown`.
 *
 *  D4 — Single choke point. `finalizeErrorCode()` is called exactly once per
 *       terminal workflow run, inside `runWorkflowLoop`, just before the
 *       `_errorCode` value is materialized into the execution summary,
 *       result-file, envelope, and kernel artifact. Adapter / coordinator /
 *       session layers are NOT rewritten; they remain free to produce any
 *       string, and the choke point reconciles it.
 *
 *  Explicit non-goals for K2 (do not drift here):
 *    • no result shape change       (KernelResult.error stays string|null)
 *    • no error-message overhaul    (we normalize codes, not free text)
 *    • no adapter refactor          (emission sites stay put)
 *    • no envelope widening         (ExecutionResultPayload stays legacy)
 *    • no terminal-record widening  (WorkflowTerminalRecord stays legacy)
 *    • no raw Node error cleanup    (except codes that reach the final path)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  Canonical code universe (19 codes, closed set)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  Adapter-layer (11) — surfaced verbatim from the executor / FS-op seam:
 *    target_exists           FS-op only; CLI HELP_TEXT + CliErrorCode
 *    file_not_found          cursor session + FS-op + validator
 *    merge_conflict          cursor session + FS-op + validator
 *    old_value_not_found     cursor session only
 *    ambiguous_match         cursor session only
 *    scope_outside_allowed   cursor session only — outside `allowedFiles`
 *    prohibited_pattern_match cursor session only
 *    parse_error             cursor session + NL normalizer + skipped-by-intake
 *                            synthesis. **Overloaded — see INV-K2-PE-1 below.**
 *    delivery_timeout        declared code; documented in HELP_TEXT
 *    invalid_path            S1/#26 — validator only — null byte in path
 *    outside_workspace       S2/#36 — validator + executor defense-in-depth —
 *                            resolved abs path is not under workspaceRoot
 *                            (POSIX abs, Windows drive-rooted/drive-relative,
 *                            UNC, `..`-after-normalize)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  INV-K2-PE-1 (locked-but-deferred-debt) — `parse_error` triple-overload
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  The canonical code `"parse_error"` has THREE distinct upstream origins
 *  today. All three collapse to the same public string; consumers of
 *  `KernelResult.error` cannot distinguish them:
 *
 *    (a) NL normalizer received empty / whitespace-only input.
 *        → arrives via `params.capturedErrorCode = "parse_error"` (from
 *          the cursor session's normalizer path).
 *
 *    (b) Cursor adapter received an artifact with no `parsedChange`.
 *        → arrives via `params.capturedErrorCode = "parse_error"` (from
 *          `CursorInProcessAdapter.receive()` line 165).
 *
 *    (c) Coordinator auto-skipped a task because intake mode was not
 *        "execute" (the `skipped_by_intake` path in `coordinator.ts`).
 *        → synthesized HERE via `params.skippedByIntake = true`.
 *
 *  K2 deliberately preserves the overload — splitting it requires a public
 *  surface change (one or more new canonical codes) which the K2 D-locks
 *  explicitly forbid. The split is documented as deferred-debt in
 *  `docs/KERNEL_RUN_COMMAND_DETERMINISM_DESIGN.md` (K5 design doc, §11).
 *
 *  This block is the SINGLE source of truth for the overload. When the
 *  split lands, update §11 of the K5 doc first, then this block.
 *
 *  CLI-layer (7) — synthesized at the orchestration boundary:
 *    conflicting_input_sources
 *    invalid_json
 *    invalid_op
 *    unsupported_or_unparsed_steps
 *    no_tasks_found
 *    safety_block
 *    execution_error           generic non-classified fallback (main.ts
 *                              synthesizes this when a failureNote lands
 *                              without an explicit code). Stays in the set
 *                              for back-compat of the --output json contract.
 *
 *  Consensus (3) — claude-only refused_due_to_execution_error codes. Until
 *  K2 these never reached the final summary because main.ts only captured
 *  errorCode from cursor sessions; K2's widened capture now surfaces them:
 *    consensus_no_quorum
 *    consensus_capability_split
 *    consensus_timeout
 *
 *  Defensive (1):
 *    unknown                   terminal fallback; see D3
 *
 *  Grand total: 22 codes (21 load-bearing + `unknown`).
 *  (S1/#26 added `invalid_path`; S2/#36 added `outside_workspace`.)
 */
/**
 * The closed set of error codes the final CLI surface is permitted to emit.
 *
 * Keyed as a readonly record so (a) the set is enumerable at runtime for
 * test assertions, (b) TypeScript infers a union of string literals, and
 * (c) new codes require a type-level addition here (single source of truth).
 *
 * Keep this lexicographically sorted within each tier for readability and
 * to make diffs obvious. The order has no semantic meaning.
 */
export declare const CANONICAL_ERROR_CODES: {
    readonly ambiguous_match: true;
    readonly delivery_timeout: true;
    readonly file_not_found: true;
    readonly invalid_path: true;
    readonly merge_conflict: true;
    readonly old_value_not_found: true;
    readonly outside_workspace: true;
    readonly parse_error: true;
    readonly prohibited_pattern_match: true;
    readonly scope_outside_allowed: true;
    readonly target_exists: true;
    readonly conflicting_input_sources: true;
    readonly execution_error: true;
    readonly invalid_json: true;
    readonly invalid_op: true;
    readonly no_tasks_found: true;
    readonly safety_block: true;
    readonly unsupported_or_unparsed_steps: true;
    readonly consensus_capability_split: true;
    readonly consensus_no_quorum: true;
    readonly consensus_timeout: true;
    readonly unknown: true;
};
/**
 * The TypeScript type corresponding to CANONICAL_ERROR_CODES.
 *
 * Any value typed `CanonicalErrorCode` is guaranteed to be one of the
 * literal strings above. Use this as the return type of normalizers and
 * the input type of anything that persists a code into a durable artifact.
 */
export type CanonicalErrorCode = keyof typeof CANONICAL_ERROR_CODES;
/**
 * Runtime predicate: true iff `value` is a canonical error code string.
 *
 * Accepts only exact, case-sensitive matches against the keys of
 * CANONICAL_ERROR_CODES. No trimming, no casefolding — callers that want
 * those behaviors must apply them before calling (see normalizeFinalErrorCode
 * for the documented normalizer rules).
 */
export declare function isCanonicalErrorCode(value: unknown): value is CanonicalErrorCode;
/**
 * Normalize a raw error-code string (from any upstream emission site) into
 * a canonical code, `null` for success, or the defensive `"unknown"`.
 *
 * Rules (locked in K2 decision pass):
 *
 *   • `null` / `undefined`     → `null`          (no failure; success path)
 *   • empty / whitespace-only  → `"unknown"`     (code was provided but empty)
 *   • exact canonical match    → that code       (pass-through, case-sensitive)
 *   • anything else            → `"unknown"`     (defensive; not a silent bucket)
 *
 * Case-sensitivity and no-trim-before-compare are deliberate: canonical
 * codes are produced by code (not user input), so "TARGET_EXISTS" or
 * " target_exists " indicates an upstream bug, not a formatting accident.
 * Collapsing to `"unknown"` makes that bug visible without crashing.
 */
export declare function normalizeFinalErrorCode(raw: string | null | undefined): CanonicalErrorCode | null;
/**
 * Inputs to the final error-code materialization — the exact set main.ts
 * has assembled by the time a WorkflowRun reaches a terminal phase.
 *
 * Keeping this as an explicit params shape (rather than three positional
 * args) lets the caller in main.ts read like documentation and lets the
 * test matrix enumerate combinations explicitly.
 */
export type FinalizeErrorCodeParams = {
    /**
     * The error code captured from the currently-active session's
     * `executionResult.errorCode` (cursor or claude, see main.ts capture
     * block). Null when no session carried a structured code.
     *
     * Note: this is `string | null` deliberately; an upstream session layer
     * is free to produce any string it wants. The normalizer reconciles.
     */
    readonly capturedErrorCode: string | null;
    /**
     * The display.failureNote captured off the terminal run. When non-null
     * but `capturedErrorCode` is null, K2 preserves the pre-existing
     * synthesis rule: "there was a failure, but no one tagged it with a
     * machine code, so call it `execution_error`". This matches the
     * current --output json contract and the HELP_TEXT documentation.
     */
    readonly capturedFailureNote: string | null;
    /**
     * True iff any task in the terminal run ended with outcome
     * `"skipped_by_intake"`. This is the NL-intake leak path from
     * coordinator.ts — auto-skipped when intake mode !== "execute".
     *
     * When this flag drives the precedence chain (i.e. no captured
     * code, no failure note), the synthesized code is `"parse_error"`.
     * This is origin (c) of the three documented in INV-K2-PE-1 above —
     * splitting the public code is deferred to the K5 design surface.
     */
    readonly skippedByIntake: boolean;
};
/**
 * Finalize the terminal error code for the current workflow run.
 *
 * This is the SINGLE choke point documented in K2 D4. All downstream
 * consumers (ExecutionSummary.error, WorkflowResult.errorCode,
 * KernelResult.error, shadow envelope's ExecutionResultPayload.errorCode,
 * --output json's `error`) observe the value returned here.
 *
 * Precedence (preserved verbatim from pre-K2 main.ts:1221-1223):
 *
 *   1. `capturedErrorCode` if present
 *   2. else `"execution_error"` if a failureNote was captured
 *   3. else `"parse_error"` if any task was skipped-by-intake
 *      (INV-K2-PE-1 origin (c) — see module header)
 *   4. else `null` (success path — no error to report)
 *
 * The precedence logic lives in the internal `synthesizeRawErrorCode`
 * helper above. Its output is then run through `normalizeFinalErrorCode`,
 * so every value this function returns is either a `CanonicalErrorCode`
 * or `null`. `KernelResult.error` and the envelope's `errorCode` accept
 * `string | null` (D1), so we widen on the way out for back-compat.
 */
export declare function finalizeErrorCode(params: FinalizeErrorCodeParams): CanonicalErrorCode | null;
//# sourceMappingURL=error-codes.d.ts.map