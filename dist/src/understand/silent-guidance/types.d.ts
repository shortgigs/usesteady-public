/**
 * Silent Guidance Mode — the shape-based template selector for bridge-silent flows.
 *
 * ── Purpose ─────────────────────────────────────────────────────────────────
 *
 * When the Intent Interpretation Bridge is eligible but no interpreter claims
 * the input (bridgeSilenceReason === "no_interpreter_claimed"), the system
 * still needs to show guidance.  The default code-patch template is often
 * misleading for non-patch requests (ops, QA, content, schema, etc.).
 *
 * SilentGuidanceMode selects which generic template to render.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────────
 *
 *   NOT an intent classifier        — produces no category or confidence
 *   NOT an interpreter              — does not enter IntentInterpretation
 *   NOT in UCP                      — no envelope emitted
 *   NOT in GuidancePayload.interpretation — interpretation field unchanged
 *   NOT authority-bearing           — does not affect mode, signal, intentState
 *
 * ── What this IS ─────────────────────────────────────────────────────────────
 *
 *   Purely presentation-level guidance shaping.
 *   Replaces nextSteps in GuidancePayload with mode-appropriate generic steps.
 *   missing[] is always preserved unchanged.
 *
 * ── Mode semantics ────────────────────────────────────────────────────────────
 *
 *   "investigation"     QA, debugging, bug reproduction, smoke tests, mocks
 *   "operation"         Infra, deployments, pipelines, schema changes, migrations
 *   "content_iteration" Copy, UX text, product description, taglines, user flow
 *   "code_patch"        Explicit code patch intent not claimed by any interpreter
 *   "boundary"          Out-of-scope: multi-step feature development, architectural work
 *   "unknown"           Fallback: vague, cross-domain, or ambiguous request shape
 */
export type SilentGuidanceMode = "investigation" | "operation" | "content_iteration" | "code_patch" | "boundary" | "unknown";
//# sourceMappingURL=types.d.ts.map