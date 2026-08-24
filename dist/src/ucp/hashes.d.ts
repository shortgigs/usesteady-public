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
export declare function stableStringify(value: unknown): string;
export declare function sha256(input: string): string;
export declare function hashObject(obj: unknown): string;
//# sourceMappingURL=hashes.d.ts.map