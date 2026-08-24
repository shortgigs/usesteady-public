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
/** Common source / config extensions — parent dirs with these suffixes are refused. */
const SOURCE_CONFIG_EXTENSIONS = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "json", "yml", "yaml", "md", "markdown",
    "css", "scss", "sass", "less",
    "html", "htm", "svg", "xml",
    "toml", "lock", "env",
]);
function splitPathSegments(path) {
    return path.split(/[\/\\]/).filter((s) => s.length > 0);
}
function extensionFromSegment(segment) {
    // Hidden/tool dirs (`.github`, `.vscode`) — not file-extension parents.
    if (segment.startsWith("."))
        return null;
    const lastDot = segment.lastIndexOf(".");
    if (lastDot <= 0)
        return null;
    const ext = segment.slice(lastDot + 1).toLowerCase();
    if (ext.length === 0 || ext.length > 10)
        return null;
    if (!/^[a-z0-9]+$/.test(ext))
        return null;
    return SOURCE_CONFIG_EXTENSIONS.has(ext) ? ext : null;
}
/**
 * Returns the first parent segment (not the basename) whose name looks like
 * a source/config file. Returns `null` when the path is clean.
 */
export function findExtensionBearingParentSegment(path) {
    if (typeof path !== "string" || path.length === 0)
        return null;
    const segments = splitPathSegments(path);
    if (segments.length < 2)
        return null;
    for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        const ext = extensionFromSegment(segment);
        if (ext === null)
            continue;
        return {
            segment,
            parentPath: segments.slice(0, i + 1).join("/"),
            extension: ext,
        };
    }
    return null;
}
//# sourceMappingURL=path-segment-semantics.js.map