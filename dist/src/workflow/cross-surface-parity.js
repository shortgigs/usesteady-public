/**
 * cross-surface-parity — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 4).
 *
 * The single source of truth for the pre-execution ENGINE OBJECTS that the Web
 * (`server.ts` POST /api/workflow/start) and the CLI (`use-steady.ts`
 * cliRecoverySurface / delegateRawInputToWorkflow) must agree on for the same NL
 * input. The renderers (renderSurfaceCli, renderSurfaceWeb) may differ; the
 * objects below must not.
 *
 * Closed set of parity-bound artifacts:
 *   - SpecSafetyVerdict     (Phase 2 single-authority safety, AHEAD of routing)
 *   - RoutingSurface        (the shared three-outcome brain, routeRequestToSurface)
 *   - intentReflection      (the deterministic REFLECTION artifact, when it fires)
 *   - DecisionBasis         (Article VI eight-class basis of the proposal)
 *   - decisionBasisFingerprint (SHA-256 of the basis — what an ApprovalRecord binds)
 *
 * Why this exists: Phase 3C proved the routing BRAIN is shared and the two
 * renderers are total/pure. Phase 4 proves the OBJECTS are byte-identical across
 * surfaces by computing them ONCE here, from the same shared engine functions
 * both surfaces already call (`synthesizeStructuredFieldsFromNL`,
 * `gateWorkflowSpecSafety`, `routeRequestToSurface`, `assembleDecisionBasis`,
 * `computeDecisionBasisFingerprint`). The parity test and totality cert drive
 * this module and assert the renderers are pure projections of `surface`.
 *
 * Zero authority (Invariant 1): nothing here executes, approves, gates, or
 * touches the filesystem. It is a pure, deterministic projection of
 * (rawInput, root, suggest, repository).
 *
 * Determinism + the single surface-assigned field: `assembleDecisionBasis`
 * embeds `proposal.name = spec.name`, which is cosmetic metadata each surface
 * assigns differently (Web: request name; CLI recovery: "NL recovery"). It is
 * NOT input-derived, so the cross-surface parity claim canonicalizes it out
 * (see `proposalContentKey`) and asserts parity on the proposal TASKS plus the
 * repository / configuration / policies facts. The fingerprint is reported as a
 * function of the canonical spec name this module assigns, so callers comparing
 * fingerprints across surfaces must use the same `specName`.
 */
import { gateWorkflowSpecSafety } from "./spec-safety-gate.js";
import { routeRequestToSurface } from "./route-to-surface.js";
import { assembleDecisionBasis, computeDecisionBasisFingerprint } from "../constitution/index.js";
import { synthesizeStructuredFieldsFromNL } from "../shell/cli/spec-nl-synth.js";
/**
 * Build the canonical synthesized first task for a bare-NL input via the SINGLE
 * canonical synth both surfaces use. Failed synthesis falls back to raw `input`
 * only (recovery-eligible), exactly as `server.ts` and `cliRecoverySurface` do.
 */
export function synthesizeFirstTaskFromNL(rawInput) {
    const synth = synthesizeStructuredFieldsFromNL(rawInput);
    return synth.ok ? { input: rawInput, ...synth.fields } : { input: rawInput };
}
/**
 * Build the canonical single-task synthesized spec for an NL input. `name` is
 * cosmetic (see module header) — callers comparing fingerprints across surfaces
 * must pass the SAME name.
 */
export function buildSynthesizedSpecFromNL(rawInput, name) {
    return { name, tasks: [synthesizeFirstTaskFromNL(rawInput)] };
}
/**
 * The shared engine core: compute the cross-surface artifacts for an already-
 * built `WorkflowSpec`, in the exact order both surfaces apply them — safety
 * (single authority, ahead of routing) -> route (skipped on block) -> decision
 * basis + fingerprint. This is the single ordering authority; `computeCross-
 * SurfaceArtifacts` (NL entry) and the internal SDK both delegate here so the
 * safety-ahead-of-routing invariant lives in exactly one place.
 */
export async function computeArtifactsForSpec(args) {
    const { spec } = args;
    const firstTask = spec.tasks[0];
    const safety = gateWorkflowSpecSafety(spec);
    let surface;
    let intentReflection = null;
    if (safety.verdict !== "block") {
        const decision = await routeRequestToSurface({
            firstTask,
            synthesizedSpec: spec,
            root: args.root,
            suggest: args.suggest,
        });
        surface = decision.surface;
        intentReflection = decision.intentReflection;
    }
    const decisionBasis = assembleDecisionBasis(spec, {
        repository: args.repository ?? null,
    });
    const decisionBasisFingerprint = computeDecisionBasisFingerprint(decisionBasis);
    return {
        rawInput: firstTask?.input ?? "",
        specName: spec.name,
        safety,
        surface,
        intentReflection,
        decisionBasis,
        decisionBasisFingerprint,
        approvalParity: { decisionBasisFingerprint },
    };
}
/**
 * Compute the full set of cross-surface engine artifacts for an NL input, in the
 * exact order both surfaces apply them: synthesize -> safety (single authority,
 * ahead of routing) -> route (skipped on block) -> decision basis + fingerprint.
 */
export async function computeCrossSurfaceArtifacts(args) {
    const specName = args.specName ?? args.rawInput;
    const synthesizedSpec = buildSynthesizedSpecFromNL(args.rawInput, specName);
    const artifacts = await computeArtifactsForSpec({
        spec: synthesizedSpec,
        root: args.root,
        suggest: args.suggest,
        repository: args.repository ?? null,
    });
    // Preserve the verbatim rawInput the caller passed (computeArtifactsForSpec
    // reports firstTask.input, which for NL synthesis equals rawInput — but keep
    // this explicit so the NL-entry contract is unambiguous).
    return { ...artifacts, rawInput: args.rawInput };
}
// ─── Canonicalization (deterministic, sorted-key) ────────────────────────────
/** Stable, sorted-key JSON serialization for deterministic object diffing. */
export function canonicalize(value) {
    return JSON.stringify(sortKeysDeep(value));
}
function sortKeysDeep(value) {
    if (Array.isArray(value))
        return value.map(sortKeysDeep);
    if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortKeysDeep(value[key]);
        }
        return out;
    }
    return value;
}
/** Full canonical serialization of every parity-bound artifact. */
export function canonicalizeArtifacts(a) {
    return canonicalize({
        safety: a.safety,
        surface: a.surface,
        intentReflection: a.intentReflection,
        decisionBasis: a.decisionBasis,
        decisionBasisFingerprint: a.decisionBasisFingerprint,
        approvalParity: a.approvalParity,
    });
}
/**
 * The name-INDEPENDENT engine objects — safety verdict, routing surface, and the
 * reflection artifact. This is the strong parity key: identical across surfaces
 * regardless of the cosmetic proposal name each assigns.
 */
export function surfaceParityKey(a) {
    return canonicalize({
        safety: a.safety,
        surface: a.surface,
        intentReflection: a.intentReflection,
    });
}
/**
 * The proposal CONTENT of a DecisionBasis with the surface-assigned cosmetic
 * `proposal.name` removed — the trust-relevant facts that must match across
 * surfaces for the same input (tasks + repository + configuration + policies).
 */
export function proposalContentKey(basis) {
    const { proposal, ...rest } = basis;
    const { name: _name, ...proposalContent } = proposal;
    void _name;
    return canonicalize({ ...rest, proposal: proposalContent });
}
//# sourceMappingURL=cross-surface-parity.js.map