/**
 * UCP hashing — deterministic SHA-256 over canonically serialized objects.
 *
 * Rules:
 *   - Object keys are sorted alphabetically at every level of nesting.
 *   - Arrays preserve element order.
 *   - The hash covers all fields provided; callers must omit `hash` before hashing.
 *   - Uses Node's built-in crypto — no external deps.
 *
 * ── CRITICAL: undefined is NOT omitted ────────────────────────────────────────
 *
 *   stableStringify serializes `undefined` values as the string "undefined":
 *
 *     stableStringify({ a: undefined })  →  '{"a":"undefined"}'
 *     stableStringify({})                →  '{}'
 *
 *   This differs from JSON.stringify, which silently drops keys with undefined
 *   values. The consequence for content addressing:
 *
 *     computeId({ rejection_reason: undefined })  ≠  computeId({})
 *
 *   If a payload object with explicit undefined keys is passed to computeId,
 *   and the same payload is later serialized to disk via JSON.stringify (which
 *   strips undefined), the on-disk record will NOT reproduce the same id — the
 *   content-addressing guarantee is broken.
 *
 *   Protocol rule: ALL payload objects passed to computeId (and therefore to
 *   createEnvelope) MUST be undefined-free. Optional fields must be omitted
 *   entirely when absent — never set to undefined.
 *
 *   See: src/ucp/types.ts — "PROTOCOL INVARIANT: Payloads must be undefined-free"
 */
import { createHash } from "node:crypto";
// ─── Stable serialization ─────────────────────────────────────────────────────
export function stableStringify(value) {
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    if (typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return "[" + value.map(stableStringify).join(",") + "]";
    }
    const obj = value;
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]));
    return "{" + pairs.join(",") + "}";
}
// ─── SHA-256 helper ───────────────────────────────────────────────────────────
export function sha256(input) {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
// ─── Canonical hash for any serializable object ───────────────────────────────
export function hashObject(obj) {
    return sha256(stableStringify(obj));
}
//# sourceMappingURL=hashes.js.map