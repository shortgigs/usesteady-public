/**
 * UCP — UseSteady Control Protocol types.
 *
 * OWNERSHIP RULE: Every decision that flows through UseSteady is representable
 * as a UCPEnvelope. Envelopes are versioned, content-addressed, and hashable.
 *
 * UCPEnvelope is the canonical representation — NOT a transport wrapper.
 * The pipeline is authoritative. Envelopes are a parallel, read-only view.
 *
 * ── Envelope fields ────────────────────────────────────────────────────────
 *
 *   id      Content-addressed identifier: sha256({ type, payload, refs }).
 *           Same content → same id. Does NOT change with ts.
 *
 *   type    Dot-notation namespaced string: "ucp.intent.v1", "ucp.prv.v1", etc.
 *
 *   version Always 1 in this phase.
 *
 *   ts      Epoch milliseconds. Excluded from id and hash.
 *           Records when the envelope was created; does not affect identity.
 *
 *   payload The structured result of the relevant pipeline step.
 *           Contains ONLY fields present in the source type — no invention.
 *
 *   meta    Envelope metadata. source = the module that produced this envelope.
 *           deterministic is always true in v1 (no random-valued payloads).
 *
 *   refs    Optional parent/root references for trace chain linkage.
 *
 *   hash    Integrity hash: sha256 over { id, meta, payload, refs, type, version }.
 *           Excludes ts and hash itself.
 *
 * ── PROTOCOL INVARIANT: Payloads must be undefined-free ──────────────────
 *
 *   stableStringify (used by computeId) serializes `undefined` as the string
 *   "undefined" — it does NOT omit keys with undefined values the way
 *   JSON.stringify does. This means:
 *
 *     { rejection_reason: undefined }  →  id contains "rejection_reason":"undefined"
 *     { }                              →  id does NOT contain "rejection_reason"
 *
 *   These produce DIFFERENT content addresses for otherwise-identical payloads.
 *   If the envelope is then persisted via JSON.stringify (which strips undefined
 *   keys), the stored record diverges from the id used to index it — breaking
 *   the content-addressing guarantee.
 *
 *   CONSTRUCTION RULE (enforced by convention, checked in mappers):
 *     ✓ Omit optional fields entirely when they are absent.
 *     ✓ Use conditional spreading: ...(value !== undefined ? { key: value } : {})
 *     ✗ Never assign explicit `undefined` to a payload field.
 *     ✗ Never use Object.assign or spread with an object containing undefined values.
 *
 *   All mappers in src/ucp/mappers/ must follow this rule.
 *   Callers constructing payloads inline must follow this rule.
 */
export {};
//# sourceMappingURL=types.js.map