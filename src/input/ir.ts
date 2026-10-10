/**
 * src/input/ir.ts
 *
 * The Intermediate Representation (IR) — single canonical shape every input
 * surface (--json, batch, --prompt, positional NL, REPL) normalizes into
 * before validation and execution. Defined verbatim to match design note §5.1
 * (revision v2.1) in `docs/CLI_INPUT_NORMALIZATION_DESIGN.md`.
 *
 * Scope of this file:
 *   - Types only. Zero runtime behavior. No I/O, no validation, no defaults.
 *   - The `Operation` union is the lossless representation of user intent.
 *     The §5.2 lossless guarantee (NL must normalize to precise IR; ambiguity
 *     is a normalize-stage error) lives in the normalizers (M2 for JSON,
 *     M4 for NL). This file just defines the shape they must produce.
 *   - The `source` field is for diagnostics only; per design §5.1, the
 *     validator and executor MUST NOT branch on `source.surface`.
 *
 * Relationship to `OperationRegistry` (src/input/op-registry.ts):
 *   - `Operation["type"]` is structurally identical to `OperationType`.
 *   - The compile-time check at the bottom of this file fails the build
 *     if the two ever drift apart.
 *
 * What this file does NOT do (M2 scope):
 *   - It does not define a `CliError` shape (that's M3, per design §6).
 *   - It does not include feasibility metadata (that's M3).
 *   - It does not gate `create_dir` from the public --json / batch surface
 *     — that's the JSON adapter's job (M2, §10 #7 / D3 in the design note).
 */

import type { OperationType } from "./op-registry.js";

// ─── Operation arg shapes ────────────────────────────────────────────────────
//
// Each variant matches design §5.1 v2.1 exactly. Comments preserve the
// design's normative wording so a drift between the doc and the types is
// visible in this file too.

/** Replace occurrence selector. Per §5.1: "never undefined". */
export type ReplaceOccurrence =
  | "first"
  | "all"
  | { readonly index: number };

/**
 * The 8 operation variants of the IR. Order matches design §5.1 v2.1.
 *
 * `create_dir` is first-class per the M2 gate decision (D1, recorded in
 * §10 #7 of the design note). The public --json / batch user schema
 * remains 7 ops in M2 (D3) — the JSON adapter never emits `create_dir`.
 * The 8th IR op is reachable only from NL today and the NL surface is
 * wired in M4.
 */
export type Operation =
  | {
      readonly type: "create";
      readonly args: { readonly path: string; readonly contents?: string };
    }
  | {
      readonly type: "create_dir";
      readonly args: { readonly path: string };
    }
  | {
      readonly type: "delete";
      readonly args: { readonly path: string };
    }
  | {
      readonly type: "rename";
      readonly args: { readonly from: string; readonly to: string };
    }
  | {
      readonly type: "replace";
      readonly args: {
        readonly file: string;
        /** Per §5.1: "never empty after normalization." */
        readonly from: string;
        /** Per §5.1: "may be empty (explicit deletion is a valid op)." */
        readonly to: string;
        /** Per §5.1: "never undefined" — the normalizer must commit to one. */
        readonly occurrence: ReplaceOccurrence;
        /**
         * usesteady-public#45 (occurrence-directive truthfulness) — the
         * user's EXPLICIT directive, when present in the input.
         *
         * Separate from `occurrence` because `occurrence` is required by
         * design §5.1 ("never undefined") and the JSON adapter has to
         * commit to a value when the public JSON schema does not carry
         * the field — `requestedOccurrence` is what disambiguates "user
         * actually said this" from "adapter defaulted to this".
         *
         * Populated:
         *   - NL surface: always, since the M4 normalizer requires an
         *     explicit occurrence clause (§6.6.2 R4). The parser writes
         *     the same value into both fields.
         *   - JSON surface: only when the public JSON op contains an
         *     `occurrence` field with a recognized shape. When absent,
         *     this field is `undefined` and `occurrence` retains its
         *     adapter-side default.
         *
         * Consumed:
         *   - feasibility-validator.ts: refuses at validate stage with
         *     `ambiguous_match` when this is "all" or `{ index: N }`
         *     (the system cannot honor those today; see #45). "first"
         *     passes through to the executor unchanged.
         *   - spec-task-builder.ts / ir-to-spec-fields.ts: mirrored
         *     onto SpecTask.requestedOccurrence for preview / diagnostic
         *     rendering. Never propagated to the executor's parsedChange.
         *
         * Diagnostics-only at the executor: the executor does NOT read
         * this field. It exists to make the user's intent visible at
         * validate-stage refusals and in the preview, not to change
         * what the executor does.
         */
        readonly requestedOccurrence?: ReplaceOccurrence;
      };
    }
  | {
      readonly type: "append";
      readonly args: { readonly file: string; readonly text: string };
    }
  | {
      readonly type: "prepend";
      readonly args: { readonly file: string; readonly text: string };
    }
  | {
      readonly type: "run";
      readonly args: { readonly command: string };
    };

/**
 * Surface that produced this IR. Diagnostics-only.
 *
 * Per design §5.1: "The validator and executor MUST NOT branch on
 * `source.surface`. If they ever need to, that itself is a normalization
 * bug to be fixed at the normalizer, not papered over downstream."
 */
export type IRSourceSurface =
  | "json"
  | "prompt"
  | "positional"
  | "batch"
  | "repl";

export type IRSource = {
  readonly surface: IRSourceSurface;
  /** Exact original input, preserved verbatim per §5.3. Diagnostics only. */
  readonly raw: string;
};

/**
 * The complete IR — the only thing the validator (M3) and executor (M5+)
 * are permitted to consume per design §4 invariant #1 ("All execution MUST
 * originate from IR").
 */
export type IR = {
  /** Ordered. Non-empty after normalization succeeds. */
  readonly operations: readonly Operation[];
  readonly source: IRSource;
  /** Per §5.1: "for friction correlation, never for control flow." */
  readonly metadata?: { readonly fingerprint?: string };
};

// ─── Compile-time consistency check ──────────────────────────────────────────
//
// The IR's `Operation["type"]` and the registry's `OperationType` describe
// the same closed set. The two are defined in separate files (the registry
// is the runtime enumeration; the IR is the structural shape). This pair of
// conditional types fails to compile if either side drifts.

type _IROpsAssignableToRegistry = Operation["type"] extends OperationType ? true : never;
type _RegistryOpsAssignableToIR = OperationType extends Operation["type"] ? true : never;

// Force the checks to participate in compilation. If `Operation["type"]`
// stops matching `OperationType` (in either direction), one of these
// assignments becomes `never` and `tsc` fails this file.
const _opsCheckForward:  _IROpsAssignableToRegistry = true;
const _opsCheckBackward: _RegistryOpsAssignableToIR = true;
void _opsCheckForward;
void _opsCheckBackward;
