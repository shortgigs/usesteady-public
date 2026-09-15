/**
 * UCP Seam Projection — Phase 2 integration layer.
 *
 * UCPSeamProjection is the formal shape the shell layer exposes to surfaces
 * (CLI, web UI, or any other consumer). It is PROVABLY derived from a
 * UCPBundle — never constructed independently.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 *
 * Before Phase 2, the seam exposed `PresentationOutput` — a manually maintained
 * type that mirrored intake results but had no formal link to UCP.
 *
 * UCPSeamProjection replaces that. Every field maps to a specific envelope:
 *
 *   mode           ← bundle.response.payload.mode
 *   badge          ← derived from mode (display only)
 *   headline       ← bundle.intentInterpretation?.payload.summary
 *                    OR bundle.changeInterpretation?.payload.summary
 *                    OR bundle.response.payload.reason
 *   category       ← human label from intentInterpretation or changeInterpretation
 *   confidence     ← human label from intentInterpretation or changeInterpretation
 *   steps          ← bundle.response.payload.guidance.nextSteps[].label  (enriched form)
 *   missing        ← bundle.response.payload.guidance.missing
 *   certaintyLevel ← derived: execute+change→certain, guide+intent→inferred, else→unknown
 *   debugTrace     ← bundle.debugTrace.payload (all trace fields from the envelope)
 *
 *   envelopeIds    ← { intentId, responseId, traceId } from bundle envelope .id fields
 *                    This is the PROOF FIELD.
 *                    A consumer can verify that this projection came from a real UCPBundle
 *                    by checking that envelopeIds.responseId is a valid sha256 hex string
 *                    and matches bundle.response.id for the same input.
 *
 * ── Invariants ────────────────────────────────────────────────────────────────
 *
 *   1. projectUCPBundle is a pure function. Same bundle → same projection.
 *   2. mode is sourced from bundle.response.payload.mode — it cannot drift.
 *   3. envelopeIds are content-addressed. Same input → same IDs.
 *   4. No field may be invented. Every field is derived from a named envelope.
 *   5. A renderer MUST route on projection.mode, never on any other field.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   Not a pipeline layer. Not a decision layer. Not a transport format.
 *   It is a formal, testable projection function: f(UCPBundle) → UCPSeamProjection.
 */

import type { ResponseMode } from "../intake/types.js";
import type { IntentInterpretationCategory } from "../understand/intent-interpretation/types.js";
import type { InterpretationCategory } from "../understand/interpretation/types.js";
import type { DebugTracePayload } from "./types.js";
import type { UCPBundle } from "../intake/intake-service.js";

// ─── Envelope IDs proof type ──────────────────────────────────────────────────

/**
 * Three content-addressed sha256 envelope IDs that prove this projection
 * was derived from a real UCPBundle.
 *
 * These IDs are deterministic:
 *   Same input → same intentId, responseId, traceId.
 *
 * A consumer verifying authenticity checks:
 *   envelopeIds.responseId.match(/^[0-9a-f]{64}$/) — it is a valid SHA-256
 */
export type UCPProjectionEnvelopeIds = {
  /** bundle.intent.id — content-addressed from the raw input string. */
  readonly intentId:   string;
  /** bundle.response.id — content-addressed from mode + reason + intentState. */
  readonly responseId: string;
  /** bundle.debugTrace.id — content-addressed from all trace fields. */
  readonly traceId:    string;
};

// ─── UCPSeamProjection ────────────────────────────────────────────────────────

/**
 * The formal shape exposed to seam consumers (renderers, IPC callers).
 *
 * This type is structurally compatible with the legacy PresentationOutput
 * and UICoreIntakeResult but carries the additional envelopeIds proof field.
 *
 * Consumers that only care about rendering can ignore envelopeIds.
 * Consumers verifying UCP provenance should check it.
 */
export type UCPSeamProjection = {
  /**
   * Source: bundle.response.payload.mode
   * THE ONLY ROUTING AUTHORITY. Consumers MUST route on this field.
   */
  readonly mode: ResponseMode;

  /**
   * Source: derived from mode using MODE_BADGES lookup.
   * Display only. Does not affect routing.
   */
  readonly badge: string;

  /**
   * Source (priority order):
   *   1. bundle.intentInterpretation.payload.summary  (guide + bridge)
   *   2. bundle.changeInterpretation.payload.summary  (execute + structured patch)
   *   3. bundle.response.payload.reason               (fallback for all modes)
   */
  readonly headline: string;

  /**
   * Source: derived from mode + interpretation envelope presence.
   *   "certain"  → mode="execute" AND bundle.changeInterpretation exists
   *   "inferred" → mode="guide"   AND bundle.intentInterpretation exists
   *   "unknown"  → all other cases
   */
  readonly certaintyLevel: "certain" | "inferred" | "unknown";

  /**
   * Source: human label derived from:
   *   - bundle.intentInterpretation.payload.category  (guide mode)
   *   - bundle.changeInterpretation.payload.category  (execute mode)
   * Absent when no interpretation envelope is present.
   */
  readonly category?: string;

  /**
   * Source: human label derived from whichever interpretation envelope fired.
   * Absent when no interpretation envelope is present.
   */
  readonly confidence?: string;

  /**
   * Source: bundle.response.payload.guidance.nextSteps[].label
   * This is the ENRICHED, ordering-applied form — not the raw CompletionResult.
   * Includes interpretation-improved labels and session-ordered steps.
   * Present only when mode === "guide".
   */
  readonly steps?: ReadonlyArray<string>;

  /**
   * Source: bundle.response.payload.guidance.missing
   * Present only when mode === "guide".
   */
  readonly missing?: ReadonlyArray<string>;

  /**
   * Source: bundle.debugTrace.payload (all 6 trace fields from the envelope).
   * Zero authority. Developer-facing observability only.
   */
  readonly debugTrace?: DebugTracePayload;

  /**
   * Proof field: three content-addressed envelope IDs.
   * These IDs are sha256 hashes. Same input → same IDs (content-addressed).
   * Their presence proves this projection came from a UCPBundle.
   */
  readonly envelopeIds: UCPProjectionEnvelopeIds;
};

// ─── Display name maps ────────────────────────────────────────────────────────

const MODE_BADGES: Record<ResponseMode, string> = {
  refuse:  "REFUSE",
  ignore:  "IGNORE",
  clarify: "CLARIFY",
  guide:   "GUIDE",
  execute: "EXECUTE",
};

const CONFIDENCE_LABELS: Record<"high" | "medium" | "low", string> = {
  high:   "High confidence",
  medium: "Medium confidence",
  low:    "Low confidence",
};

const INTENT_CATEGORY_LABELS: Record<IntentInterpretationCategory, string> = {
  visual_color:       "Color / style change",
  text_change:        "Text / copy change",
  config_change:      "Configuration change",
  workflow_operation: "Workflow operation",
  unknown:            "Unclassified",
};

const CHANGE_CATEGORY_LABELS: Record<InterpretationCategory, string> = {
  tailwind_color_change: "Tailwind color change",
  css_color_change:      "CSS color change",
  text_literal_change:   "Text / copy change",
  config_value_change:   "Configuration value change",
};

// ─── Projection function ──────────────────────────────────────────────────────

/**
 * Project a UCPBundle into a UCPSeamProjection.
 *
 * Pure function — same bundle → same projection, always.
 * No side effects. No I/O. No randomness.
 *
 * Every output field documents its source envelope in the type definition above.
 */
export function projectUCPBundle(bundle: UCPBundle): UCPSeamProjection {
  // ── Source: response envelope (always present) ─────────────────────────────
  const mode    = bundle.response.payload.mode;
  const badge   = MODE_BADGES[mode];
  const reason  = bundle.response.payload.reason;

  // ── Source: interpretation envelopes (optional) ────────────────────────────
  const intentInterp  = bundle.intentInterpretation?.payload;
  const changeInterp  = bundle.changeInterpretation?.payload;

  // ── Headline: first non-null interpretation summary, then reason ───────────
  const headline =
    intentInterp !== undefined ? intentInterp.summary  :
    changeInterp !== undefined ? changeInterp.summary  :
    reason;

  // ── Category and confidence: from whichever interpretation envelope fired ──
  const category =
    intentInterp !== undefined ? INTENT_CATEGORY_LABELS[intentInterp.category] :
    changeInterp !== undefined ? CHANGE_CATEGORY_LABELS[changeInterp.category] :
    undefined;

  const confidence =
    intentInterp !== undefined ? CONFIDENCE_LABELS[intentInterp.confidence] :
    changeInterp !== undefined ? CONFIDENCE_LABELS[changeInterp.confidence] :
    undefined;

  // ── Certainty: derived from mode + interpretation presence ─────────────────
  const certaintyLevel: "certain" | "inferred" | "unknown" =
    mode === "execute" && changeInterp !== undefined ? "certain"  :
    mode === "guide"   && intentInterp !== undefined ? "inferred" :
    "unknown";

  // ── Steps and missing: from the response envelope's enriched guidance ─────
  //
  // IMPORTANT: we use bundle.response.payload.guidance rather than
  // bundle.completion.payload.nextSteps because:
  //   - completion envelope = raw CompletionResult (before enrichGuidance)
  //   - response envelope   = final IntakeResult guidance (after enrichGuidance
  //                           + applyGuidanceOrdering, including interpretation
  //                           labels and session-based ordering)
  //
  // The response envelope is the canonical, enriched form the renderer sees.
  const responseGuidance = bundle.response.payload.guidance;
  const steps: ReadonlyArray<string> | undefined =
    responseGuidance !== undefined ? responseGuidance.nextSteps.map((s) => s.label) : undefined;

  const missing: ReadonlyArray<string> | undefined =
    responseGuidance !== undefined ? [...responseGuidance.missing] : undefined;

  // ── Debug trace: from debug trace envelope payload ─────────────────────────
  const debugTrace: DebugTracePayload = bundle.debugTrace.payload;

  // ── Proof field: content-addressed envelope IDs ────────────────────────────
  const envelopeIds: UCPProjectionEnvelopeIds = {
    intentId:   bundle.intent.id,
    responseId: bundle.response.id,
    traceId:    bundle.debugTrace.id,
  };

  // ── Assemble output (exactOptionalPropertyTypes-safe spreading) ────────────
  return {
    mode,
    badge,
    headline,
    certaintyLevel,
    ...(category   !== undefined ? { category   } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(steps      !== undefined ? { steps      } : {}),
    ...(missing    !== undefined ? { missing    } : {}),
    debugTrace,
    envelopeIds,
  };
}
