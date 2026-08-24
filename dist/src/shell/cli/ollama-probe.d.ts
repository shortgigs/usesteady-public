/**
 * Ollama reachability probe for `usesteady doctor` (P0-1).
 *
 * Read-only localhost HTTP check only. No model selection, no generation,
 * no routing, no LLM adapter imports.
 */
export type OllamaProbeOutcome = {
    readonly kind: "reachable";
    readonly endpoint: string;
} | {
    readonly kind: "not_configured";
} | {
    readonly kind: "unreachable";
    readonly endpoint: string;
};
/** Normalize OLLAMA_HOST / default endpoint to a probe base URL (no trailing slash). */
export declare function resolveOllamaEndpoint(env: Readonly<Record<string, string | undefined>>): string | null;
export declare function buildOllamaTagsUrl(endpoint: string): string;
/**
 * Probe Ollama `/api/tags` on localhost (or OLLAMA_HOST). Injectable fetch for tests.
 */
export declare function probeOllamaReachable(env?: Readonly<Record<string, string | undefined>>, fetchImpl?: typeof fetch, timeoutMs?: number): Promise<OllamaProbeOutcome>;
//# sourceMappingURL=ollama-probe.d.ts.map