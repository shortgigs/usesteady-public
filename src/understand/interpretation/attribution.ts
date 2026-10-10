/**
 * Presence-attribution logic (canonical, single source).
 *
 * Answers one question for a present fact: does its value trace to the literal
 * request the human typed? If yes, the fact arrived by PROVISION -- the only
 * arrival mechanism on the certified deterministic path (normalizeIntent).
 *
 * This is the single source of the attribution DECISION. Every surface that
 * attributes a present fact -- the certification harness
 * (`scripts/cert-presence-mechanism.ts`) and the approval UI (mirrored in
 * `ui/src/helpers/attribution.ts`) -- uses this same decision so they cannot
 * diverge. Provenance phrasing is left to each surface; only the decision is
 * shared.
 *
 * Pure: no I/O, no node deps, no authority. Governed by
 * USESTEADY_PRESENCE_ATTRIBUTION_UI_IMPLEMENTATION_V1 and
 * USESTEADY_PRESENCE_MECHANISM_CERTIFICATION_V1.
 */

export type AttributionResult = { readonly mechanism: "provision" };

/** Normalize for containment: lowercase, drop quotes, collapse whitespace. */
export function normalizeForAttribution(s: string): string {
  return s.toLowerCase().replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Returns a provision attribution iff the present fact's value traces to the
 * literal input; otherwise null (the fact has no derivable provision span).
 */
export function attributeFact(value: string, input: string): AttributionResult | null {
  const v = normalizeForAttribution(value);
  if (v.length === 0) return null;
  return normalizeForAttribution(input).includes(v) ? { mechanism: "provision" } : null;
}
