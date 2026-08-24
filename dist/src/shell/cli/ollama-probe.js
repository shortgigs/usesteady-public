/**
 * Ollama reachability probe for `usesteady doctor` (P0-1).
 *
 * Read-only localhost HTTP check only. No model selection, no generation,
 * no routing, no LLM adapter imports.
 */
const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const PROBE_TIMEOUT_MS = 2_000;
function ollamaDisabled(env) {
    const raw = env["USESTEADY_OLLAMA"]?.trim().toLowerCase();
    return raw === "0" || raw === "false" || raw === "off";
}
/** Normalize OLLAMA_HOST / default endpoint to a probe base URL (no trailing slash). */
export function resolveOllamaEndpoint(env) {
    if (ollamaDisabled(env))
        return null;
    const host = env["OLLAMA_HOST"]?.trim();
    if (host) {
        return host.includes("://") ? host.replace(/\/$/, "") : `http://${host}`.replace(/\/$/, "");
    }
    return DEFAULT_OLLAMA_ENDPOINT;
}
export function buildOllamaTagsUrl(endpoint) {
    return `${endpoint.replace(/\/$/, "")}/api/tags`;
}
/**
 * Probe Ollama `/api/tags` on localhost (or OLLAMA_HOST). Injectable fetch for tests.
 */
export async function probeOllamaReachable(env = process.env, fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS) {
    if (ollamaDisabled(env)) {
        return { kind: "not_configured" };
    }
    const explicitHost = Boolean(env["OLLAMA_HOST"]?.trim());
    const endpoint = resolveOllamaEndpoint(env);
    if (endpoint === null) {
        return { kind: "not_configured" };
    }
    try {
        const response = await fetchImpl(buildOllamaTagsUrl(endpoint), {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
            return { kind: "reachable", endpoint };
        }
        return explicitHost
            ? { kind: "unreachable", endpoint }
            : { kind: "not_configured" };
    }
    catch {
        return explicitHost
            ? { kind: "unreachable", endpoint }
            : { kind: "not_configured" };
    }
}
//# sourceMappingURL=ollama-probe.js.map