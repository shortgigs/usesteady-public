/**
 * Kernel v1 — deterministic replay artifact types.
 *
 * Scope (PR-K1, locked):
 *   - artifact.ir      = existing WorkflowSpec JSON (reused verbatim, no adapter)
 *   - artifact.result  = deterministic summary only (no stdout/stderr/exitCode/paths/timestamps)
 *   - artifact.checksum = sha256(stableStringify({ ir, result }))
 *   - No wall-clock time, no randomness, no runId, no workspaceRoot inside the hash input.
 *
 * This module is intentionally independent of src/ucp/. It reuses the pure
 * stableStringify/sha256 helpers from ucp/hashes.ts (pure utilities, no engine
 * coupling) but does not participate in the UCP envelope protocol.
 */

import type { WorkflowSpec } from "../workflow/types.js";

// ─── Result ───────────────────────────────────────────────────────────────────
// A stable, deterministic summary of one workflow run.
// No stdout, no stderr, no exitCode, no paths, no timestamps — by design.

export type KernelResult = {
  readonly success:         boolean;
  readonly error:           string | null;
  readonly executed_steps:  number;
  readonly failed_at_step:  number | null;
  readonly total_steps:     number;
};

// ─── Artifact ─────────────────────────────────────────────────────────────────
// The entire on-disk record. Content-addressed via checksum.
// Filename convention: {storeDir}/replay/<checksum>.artifact.json.

export type KernelArtifact = {
  readonly version:  "kernel.v1";
  readonly ir:       WorkflowSpec;
  readonly result:   KernelResult;
  readonly checksum: string;
};

// ─── Replay verdict ───────────────────────────────────────────────────────────
// Output of `usesteady replay <file>`. Two states only — mismatch covers every
// failure mode (mutation, corruption, truncation, broken producer).

export type ReplayVerdict = {
  readonly replay:            "match" | "mismatch";
  readonly original_checksum: string;
  readonly new_checksum:      string;
};

// ─── Execution-replay verdict (K4) ────────────────────────────────────────────
//
// Output of `usesteady replay <file> --execute`. New sibling type — the K1
// `ReplayVerdict` above is intentionally NOT extended (K4-I7 / K4-I8 in
// docs/KERNEL_EXECUTION_REPLAY_DESIGN.md). Three terminal arms:
//
//   "match"    — re-execution in a fresh sandbox produced an identical
//                KernelResult (every field equal). Bisimulation claim.
//   "mismatch" — re-execution produced a different KernelResult; the artifact
//                claims an outcome the IR no longer reproduces from clean
//                preconditions.
//   "refused"  — IR contains a non-deterministic / non-replayable task.
//                K4 does not silently fall back; the user gets the offending
//                task index. Aligned with PR-3's no-silent-skip principle.
//
// The "mode" tag is always "execute" in this type. It exists so consumers
// reading verdict JSON can distinguish K4 output from a K1 ReplayVerdict
// without inspecting the absence of fields.

export type ExecutionReplayVerdict =
  | {
      readonly replay:            "match" | "mismatch";
      readonly mode:              "execute";
      readonly original_checksum: string;
      readonly new_checksum:      string;
      readonly result_match:      boolean;
      readonly replay_result:     KernelResult;
    }
  | {
      readonly replay:            "refused";
      readonly mode:              "execute";
      // K5 (v1.0 design lock section 3 D4) ADDITIVELY widened this discriminant
      // to distinguish:
      //   "non_deterministic_task"     - the historical K4 catch-all for any
      //                                  IR-level refusal (bare NL, path escape,
      //                                  unknown operationType, etc.)
      //   "non_deterministic_command"  - K5: the IR contains a `run_command`
      //                                  task whose command string is NOT in
      //                                  the K5 closed allow-list (echo / true
      //                                  / false). This separation lets users
      //                                  distinguish "we can never replay this
      //                                  task shape" from "this command shape
      //                                  is outside the deterministic universe."
      //
      // K6 (v1.0 design doc section 10) ADDITIVELY widens this discriminant
      // a second time:
      //   "non_deterministic_inline_js" - K6: the IR contains a `run_command`
      //                                   task whose command MATCHES the K6
      //                                   prefix shape `node -e "<BODY>"` BUT
      //                                   whose BODY is not in the K6 closed
      //                                   allow-list of inline-JS forms. This
      //                                   is the precise K6 contribution: a
      //                                   distinct refusal reason for the
      //                                   K6-shaped-but-out-of-K6-scope case,
      //                                   so observers can tell "this command
      //                                   shape is K6 but the body fell out"
      //                                   apart from "this command shape is
      //                                   not even K5/K6 in form."
      //
      // TypeScript exhaustiveness: every `switch` over this `reason` MUST
      // explicitly handle the new variant (K6 design doc section 10.4).
      readonly reason:
        | "non_deterministic_task"
        | "non_deterministic_command"
        | "non_deterministic_inline_js";
      readonly task_index:        number;          // 1-based, matches PR-2
      readonly original_checksum: string;
      readonly new_checksum:      null;
    };

// ─── Classifier result (K4 + K5) ──────────────────────────────────────────────
//
// Pure pre-pass over `WorkflowSpec.tasks`. Drives the per-IR refusal in
// runExecutionReplay (K4-I10: refusal is per-IR, never per-task partial
// execution). The 1-based `task_index` matches PR-2's `failed_at_step`
// convention so error surfaces are interchangeable.
//
// K5 (v1.0 section 3 D5) ADDITIVELY adds an optional `reason` field to the
// non_replayable arm. Pre-K5 callers that read only `verdict` and `task_index`
// continue to work unchanged. The reason is the same closed enum as on
// ExecutionReplayVerdict.refused.
//
// K6 (v1.0 design doc section 10) ADDITIVELY widens the closed reason enum
// with `"non_deterministic_inline_js"` for the K6-shape-but-out-of-K6-scope
// case (`node -e "<BODY>"` where BODY is not in the K6 allow-list).

export type ClassifierResult =
  | { readonly verdict: "replayable" }
  | {
      readonly verdict:    "non_replayable";
      readonly task_index: number;
      readonly reason?:
        | "non_deterministic_task"
        | "non_deterministic_command"
        | "non_deterministic_inline_js";
    };
