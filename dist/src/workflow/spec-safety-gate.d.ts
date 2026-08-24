/**
 * Workflow spec safety gate — single-authority safety for the web entry path.
 *
 * USESTEADY Trust Surface Model, Phase 2 (single-authority safety).
 *
 * The CLI runs `runSafetyGate` on the verbatim NL of every entry surface
 * (draft, json, nl) before any SYSTEM WILL preview is shown. The web
 * `POST /api/workflow/start` historically ran NO safety gate at all, so the
 * approval boundary depended on the entry path. This module closes that gap:
 * it applies the SAME `runSafetyGate` to a `WorkflowSpec` so both surfaces
 * share one safety authority.
 *
 * Shared-module discipline (mirrors `clarify-surface.ts`): `server.ts` and the
 * test/cert import THIS function, so the safety decision exercised in tests is
 * the exact decision the web surface makes.
 *
 * Authority: this is the safety gate (a constraint authority), not a routing
 * descriptor. It returns a verdict; it never executes, approves, or mutates.
 * Safety verdicts are evaluated on the user's verbatim intent (`task.input`)
 * and on any explicit `command`, matching the CLI's verbatim-NL gating surface.
 */
import type { WorkflowSpec } from "./types.js";
import type { SafetyReason } from "../safety/types.js";
export type SpecSafetyVerdict = {
    readonly verdict: "allow";
} | {
    readonly verdict: "block";
    readonly reason?: SafetyReason;
    readonly detectorId?: string;
    readonly matchedPattern?: string;
    readonly note?: string;
    /** Index of the task whose input first blocked. */
    readonly blockedTaskIndex: number;
    /** The exact string that triggered the block (verbatim). */
    readonly blockedInput: string;
};
/**
 * Gate every task in a spec through the shared `runSafetyGate`, returning the
 * FIRST blocking verdict (fail-closed, deterministic by task order). Each task
 * is gated on its verbatim `input` and, when present, its explicit `command`.
 *
 * Returns `{ verdict: "allow" }` only when no task blocks on any surface.
 */
export declare function gateWorkflowSpecSafety(spec: WorkflowSpec): SpecSafetyVerdict;
//# sourceMappingURL=spec-safety-gate.d.ts.map