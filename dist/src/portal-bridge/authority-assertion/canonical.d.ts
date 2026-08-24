/**
 * P1 Authority Assertion V1 — deterministic canonical JSON (Core twin).
 *
 * The signed bytes of an authority assertion are the UTF-8 encoding of this
 * canonicalization of the payload. The algorithm must remain byte-identical to
 * the Portal (usesteady-ops) implementation in
 * `lib/portal/authorityAssertion/canonical.ts` — the golden vectors in
 * `tests/portal-bridge/authority-assertion.test.ts` are duplicated on the
 * Portal side to pin cross-repo agreement.
 *
 * Rules: object keys sorted by UTF-16 code unit, no whitespace, no optional-key
 * ambiguity (callers must materialize explicit nulls), numbers must be
 * JSON-safe (assertion payloads use integers and strings only).
 */
export declare function canonicalizeJson(value: unknown): string;
//# sourceMappingURL=canonical.d.ts.map