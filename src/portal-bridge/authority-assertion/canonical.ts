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

export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalizeJson: non-finite number is not representable");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalizeJson: unsupported value type ${typeof value}`);
}
