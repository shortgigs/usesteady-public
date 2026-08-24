/**
 * Candidate understanding — AI_SEAMS_V1 seam 1 (L2.S2).
 *
 * When the deterministic parser has ALREADY failed on an input, this module
 * asks the LLM classifier for a candidate understanding ("I think you want…")
 * that a human can confirm, correct, or decline. It is the packaging layer
 * between `classifyIntent` and the CLI confirmation gate.
 *
 * ── Contract (docs/ai-seams-v1-contract.md) ──────────────────────────────────
 *
 *   INV-AI-1  Callers may consult this ONLY after the deterministic parser
 *             returned an error. This module never runs first.
 *
 *   INV-AI-2  The returned candidate is advisory. It carries text for a human
 *             to confirm — it is never executed, never rendered as SYSTEM WILL,
 *             and never self-promotes. Confirmation happens at the caller's
 *             existing human gate, and the confirmed text re-enters the FULL
 *             deterministic pipeline (safety gate included) from the top.
 *
 *   INV-AI-3  Fail-closed: no API key, API failure, no rewrite, or a rewrite
 *             the deterministic parser cannot parse → null. The caller must
 *             treat null as "behave exactly as before this seam existed."
 *
 *   INV-AI-6  Execution never widens: a candidate is returned ONLY when its
 *             rewrite parses deterministically (`normalizeNLToIR` → ok). The
 *             model cannot introduce an operation the frozen parser would not
 *             itself accept.
 */
import { classifyIntent } from "./llm-classifier.js";
import { normalizeNLToIR } from "../input/nl-to-ir.js";
/**
 * Propose a candidate understanding for an input the deterministic parser
 * rejected. Returns null on every failure path (INV-AI-3) — the caller falls
 * back to today's deterministic recovery behavior.
 */
export async function proposeCandidateUnderstanding(input, classify = classifyIntent) {
    let classification;
    try {
        classification = await classify(input);
    }
    catch {
        return null;
    }
    if (classification === null)
        return null;
    // Only a validated suggested_rewrite is a confirmable candidate. A
    // clarification_question / boundary_reason keeps today's deterministic
    // recovery surface (which already handles those shapes honestly).
    const rewrite = classification.suggested_rewrite;
    if (rewrite === undefined || rewrite.trim() === "")
        return null;
    // INV-AI-6: the rewrite must land inside the frozen deterministic parser.
    // "prompt" is the canonical IR surface for reconstructed inputs (matches
    // the clarify-then-promote path).
    if (normalizeNLToIR(rewrite, "prompt").kind !== "ok")
        return null;
    return {
        rewrite: rewrite.trim(),
        family: classification.intent_family,
        confidence: classification.confidence,
        originalInput: input,
    };
}
//# sourceMappingURL=candidate-understanding.js.map