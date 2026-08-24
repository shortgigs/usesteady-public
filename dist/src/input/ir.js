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
// Force the checks to participate in compilation. If `Operation["type"]`
// stops matching `OperationType` (in either direction), one of these
// assignments becomes `never` and `tsc` fails this file.
const _opsCheckForward = true;
const _opsCheckBackward = true;
void _opsCheckForward;
void _opsCheckBackward;
export {};
//# sourceMappingURL=ir.js.map