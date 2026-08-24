/**
 * src/safety/path-segment-semantics.ts
 *
 * usesteady-public#80 — refuse paths whose *parent* segments look like
 * source/config filenames (e.g. `src/Button.tsx/index.ts` materializes a
 * directory named `Button.tsx`). Basename files such as
 * `src/components/Button.tsx` are unaffected — only intermediate segments
 * are checked.
 *
 * Pure string transform only. No filesystem access.
 */
export type ExtensionBearingParentHit = {
    /** The offending path segment (e.g. `Button.tsx`). */
    readonly segment: string;
    /** Segments from root through the offender, joined with `/`. */
    readonly parentPath: string;
    /** Lowercase extension without dot (e.g. `tsx`). */
    readonly extension: string;
};
/**
 * Returns the first parent segment (not the basename) whose name looks like
 * a source/config file. Returns `null` when the path is clean.
 */
export declare function findExtensionBearingParentSegment(path: string): ExtensionBearingParentHit | null;
//# sourceMappingURL=path-segment-semantics.d.ts.map