/**
 * src/evidence-basis/types.ts
 *
 * P4 — Evidence-basis provenance: shared factual vocabulary.
 *
 * ── What this module is ───────────────────────────────────────────────────────
 *
 *   The closed vocabulary the system uses to state, factually, what evidence
 *   basis was actually available to a model when the model produced a
 *   challenge/judgment surface (advisory position, scope refusal, consensus
 *   disagreement, friction-report verdict).
 *
 *   Every value in this module is derived from the SYSTEM EXECUTION PATH —
 *   never from what a model claims about itself. A model saying "I inspected
 *   the file" does not upgrade its evidence status; only the system's own
 *   record of what was supplied can do that.
 *
 * ── The collapse rule this vocabulary exists to prevent ───────────────────────
 *
 *   These states must never be collapsed into each other:
 *
 *     evidence-backed contradiction      (evidence supplied AND correspondence
 *                                         established AND the model's position
 *                                         actually rests on that evidence)
 *     model position without evidence    (the model never received the evidence
 *      access                            it appears to reason about)
 *     retrieval-access failure           (the mechanism that would supply
 *                                         evidence failed — no judgment basis)
 *     incomplete evidence                (a strict subset was supplied, e.g. a
 *                                         truncated extract)
 *     correspondence not established     (something was supplied, but the chain
 *                                         persisted-source ↔ model input is not
 *                                         established)
 *     comprehension unknown              (never inferred from API success)
 *
 * ── Hard rules ────────────────────────────────────────────────────────────────
 *
 *   1. There is NO boolean like `model_understood`. Comprehension is preserved
 *      as the literal "not_established" unless a future independently
 *      defensible mechanism exists. API success NEVER establishes
 *      comprehension.
 *
 *   2. `evidenceBackedContradiction` and `comprehension` are literal types,
 *      not `string` — the only expressible value is "not_established"
 *      (compile-time enforcement, same discipline as INV-SK-2 guardrails).
 *
 *   3. This module has ZERO authority. It records facts; it never affects
 *      mode, gating, consensus, or execution.
 */
/**
 * EvidenceAvailability — the closed set of states the system can actually
 * establish about a single evidence source.
 *
 *   available_and_corresponded   — the source was supplied to the model input
 *                                  AND the persisted-source ↔ model-input
 *                                  correspondence chain is established
 *                                  (structurally derivable / reconstructable).
 *   not_provided                 — the source was never supplied to the model.
 *   partial                      — a strict subset was supplied (e.g. truncated
 *                                  extract, names-without-contents, capped
 *                                  observation summary).
 *   retrieval_failed             — the mechanism that would have supplied the
 *                                  source failed (timeout, API error). This is
 *                                  an access/execution fact, NOT a judgment.
 *   correspondence_not_established — something was supplied, but the chain from
 *                                  the persisted governance record to the model
 *                                  input cannot be established for it.
 *   unknown                      — the system cannot establish any of the above.
 */
export declare const EVIDENCE_AVAILABILITY: readonly ["available_and_corresponded", "not_provided", "partial", "retrieval_failed", "correspondence_not_established", "unknown"];
export type EvidenceAvailability = (typeof EVIDENCE_AVAILABILITY)[number];
/**
 * EvidenceSourceBasis — one evidence source and its system-established
 * availability state.
 *
 * `source` is a short machine-stable label scoped to the producing surface
 * (e.g. "governed_task_spec", "file_contents", "tool_retrieval" on the
 * delivery path). `detail` is a short human-readable factual note — never
 * model prose.
 */
export type EvidenceSourceBasis = {
    readonly source: string;
    readonly availability: EvidenceAvailability;
    readonly detail?: string;
};
/**
 * EvidenceContradictionStatus — whether the model's position constitutes an
 * evidence-backed contradiction of the human's action.
 *
 * Literal type: the ONLY expressible value is "not_established". A model
 * disagreement may never be represented as evidence contradicting the human
 * unless the evidence-access and correspondence chain supporting that claim
 * is itself established — and no current surface establishes it. A future
 * mechanism that could establish it must widen this type deliberately, with
 * a named revision.
 */
export type EvidenceContradictionStatus = "not_established";
/**
 * ModelComprehensionStatus — whether the model's comprehension of the supplied
 * evidence is independently demonstrated.
 *
 * Literal type: the ONLY expressible value is "not_established".
 * Comprehension is never inferred from API success, response shape, or the
 * model's own prose. Permanent boundary: model comprehension is not
 * independently proven merely because evidence was supplied and the model
 * returned a response.
 */
export type ModelComprehensionStatus = "not_established";
/**
 * Derivation marker for evidence bases produced by structural analysis of the
 * deterministic system execution path (as opposed to model self-assertion).
 * Versioned so a future derivation mechanism is an explicit, auditable change.
 */
export declare const SYSTEM_STRUCTURAL_DERIVATION_V1: "system_structural_v1";
export type SystemStructuralDerivationV1 = typeof SYSTEM_STRUCTURAL_DERIVATION_V1;
//# sourceMappingURL=types.d.ts.map