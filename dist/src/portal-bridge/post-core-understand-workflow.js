/**
 * Best-effort POST to Core's understand-workflow endpoint so the same
 * content-addressed intent root exists on the hosted Core store (Render).
 *
 * Guarded side-channel only — failures never affect local workflow execution.
 */
import { resolveOutboundFetch } from "./outbound-fetch.js";
export const USESTEADY_CORE_URL_ENV = "USESTEADY_CORE_URL";
const DEFAULT_TIMEOUT_MS = 10_000;
export async function postCoreUnderstandWorkflow(input) {
    const trimmed = input.intent.trim();
    if (!trimmed)
        return { ok: false, reason: "empty_intent" };
    const base = input.coreBaseUrl.trim().replace(/\/+$/, "");
    if (!base)
        return { ok: false, reason: "no_core_url" };
    const fetchFn = resolveOutboundFetch(input.fetchImpl);
    if (typeof fetchFn !== "function")
        return { ok: false, reason: "fetch_unavailable" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetchFn(`${base}/api/portal/understand-workflow`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                intent: trimmed,
                context: { workspace_root: input.workspaceRoot },
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            return { ok: false, reason: `http_${response.status}` };
        }
        const body = (await response.json());
        if (body.ok !== true || typeof body.ucp_root_id !== "string" || body.ucp_root_id.length === 0) {
            return { ok: false, reason: "invalid_understand_response" };
        }
        return { ok: true, ucpRootId: body.ucp_root_id };
    }
    catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=post-core-understand-workflow.js.map