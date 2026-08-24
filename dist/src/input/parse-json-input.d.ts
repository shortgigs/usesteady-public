/**
 * src/input/parse-json-input.ts
 *
 * JSON input boundary for --json / batch surfaces (usesteady-public#79).
 *
 * ECMAScript JSON.parse silently applies last-write-wins when an object
 * contains duplicate keys. This module rejects duplicate keys in the
 * same object before parse so the operator sees a deterministic failure
 * instead of a silently discarded earlier value.
 *
 * Scope: JSON boundary only. No workflow, intake, or IR changes.
 */
export type JsonInputParseResult = {
    readonly ok: true;
    readonly value: unknown;
} | {
    readonly ok: false;
    readonly code: "invalid_json";
    readonly message: string;
};
/**
 * Parse JSON input for CLI --json / batch, refusing duplicate object keys.
 */
export declare function parseJsonInput(text: string): JsonInputParseResult;
/**
 * Return the first duplicate key name found in any JSON object, or null.
 * Nested objects are scoped independently; the same key in different
 * objects is allowed.
 */
export declare function findDuplicateJsonObjectKey(text: string): string | null;
//# sourceMappingURL=parse-json-input.d.ts.map