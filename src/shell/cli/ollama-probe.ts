/**
 * Ollama reachability probe for `usesteady doctor` (P0-1).
 *
 * Read-only localhost HTTP check only. No model selection, no generation,
 * no routing, no LLM adapter imports.
 */

export type OllamaProbeOutcome =
  | { readonly kind: "reachable"; readonly endpoint: string }
  | { readonly kind: "not_configured" }
  | { readonly kind: "unreachable"; readonly endpoint: string };

const DEFAULT_OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
const PROBE_TIMEOUT_MS = 2_000;

function ollamaDisabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env["USESTEADY_OLLAMA"]?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "off";
}

/** Normalize OLLAMA_HOST / default endpoint to a probe base URL (no trailing slash). */
export function resolveOllamaEndpoint(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (ollamaDisabled(env)) return null;

  const host = env["OLLAMA_HOST"]?.trim();
  if (host) {
    return host.includes("://") ? host.replace(/\/$/, "") : `http://${host}`.replace(/\/$/, "");
  }

  return DEFAULT_OLLAMA_ENDPOINT;
}

export function buildOllamaTagsUrl(endpoint: string): string {
  return `${endpoint.replace(/\/$/, "")}/api/tags`;
}

/**
 * Probe Ollama `/api/tags` on localhost (or OLLAMA_HOST). Injectable fetch for tests.
 */
export async function probeOllamaReachable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<OllamaProbeOutcome> {
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
  } catch {
    return explicitHost
      ? { kind: "unreachable", endpoint }
      : { kind: "not_configured" };
  }
}
