/**
 * Proposer model call — AI_SEAMS_V1 seams only (proposal, zero authority).
 *
 * Production default: **Direct** xAI / Grok (`grok-3`) via OpenAI-compatible
 * Chat Completions. Moonshot/Kimi is the explicit override
 * (`USESTEADY_PROPOSER_PROVIDER=moonshot` / `kimi`) and the R6 operational
 * fallback (timeout / 429 / 5xx / auth fail / missing XAI key) — never a
 * silent quality swap after a successful Grok response. Anthropic Haiku-class
 * remains an explicit override (`USESTEADY_PROPOSER_PROVIDER=anthropic`) and a
 * secondary R6 when Moonshot is also unavailable.
 *
 * Optional Hybrid gateway path (INV-RP-GW-1): OpenRouter when explicitly
 * selected via `USESTEADY_PROPOSER_PROVIDER=openrouter` or
 * `USESTEADY_PROPOSER_TRANSPORT=openrouter`. Fail-closed on missing
 * `OPENROUTER_API_KEY` — never silently falls back to Direct Grok/Moonshot
 * while claiming OpenRouter. Attribution: `openrouter:<model>`.
 *
 * Hard boundary: this module is for pre-approval proposer seams only.
 * Never import from executor / evidence / ratification / delivery paths.
 * Models are replaceable; fail-closed (missing key / API error → null, or
 * R6 fallback when configured on Direct paths only).
 *
 * See: docs/ai-seams-v1-contract.md, docs/ai-seams-proposer-providers.md
 * Ops parent: USESTEADY_RUNTIME_PROVIDER_ARCHITECTURE_V1 (Hybrid / INV-RP-GW-1)
 */
/** Default Anthropic proposer model (Haiku-class) — override / secondary R6. */
export declare const DEFAULT_ANTHROPIC_PROPOSER_MODEL = "claude-haiku-4-5";
/**
 * Default Moonshot proposer model — Kimi flagship chat id (2026-07-18).
 * Explicit override / R6 fallback for the Grok product default.
 * Pin via USESTEADY_MOONSHOT_MODEL=kimi-k3.
 */
export declare const DEFAULT_MOONSHOT_PROPOSER_MODEL = "kimi-k3";
/** International Moonshot OpenAI-compatible base URL. */
export declare const DEFAULT_MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
/**
 * Default xAI / Grok proposer model — matches delivery-path GROK_MODEL default
 * in src/shell/cli/main.ts. Pin in prod via USESTEADY_XAI_MODEL (or GROK_MODEL).
 */
export declare const DEFAULT_XAI_PROPOSER_MODEL = "grok-3";
/** xAI OpenAI-compatible base URL. */
export declare const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
/**
 * Default OpenRouter model — Grok via OpenRouter slug (prefer Direct for cost;
 * this is the optional gateway pin only). Pin via USESTEADY_OPENROUTER_MODEL.
 * OpenRouter deprecated `x-ai/grok-3` (404); catalog pin is grok-4.3.
 * Direct xAI default remains `grok-3` (DEFAULT_XAI_PROPOSER_MODEL) — unchanged.
 */
export declare const DEFAULT_OPENROUTER_PROPOSER_MODEL = "x-ai/grok-4.3";
/** OpenRouter OpenAI-compatible base URL. */
export declare const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export type ProposerProvider = "anthropic" | "moonshot" | "xai" | "openrouter";
/**
 * Org Hybrid preference — named Direct providers + OpenRouter gateway.
 * Portal persists and forwards on propose paths; Core overlays request env.
 * Absent → process default (today: Direct `xai:grok-3`). Gateway never gains
 * authority (INV-RP-GW-1).
 *
 * Wire aliases (parsed, never stored as preference):
 * - `direct` / `grok` → `xai`
 * - `kimi` → `moonshot`
 */
export type ProposerProviderPreference = "xai" | "moonshot" | "anthropic" | "openrouter";
/**
 * @deprecated Use `ProposerProviderPreference`. Kept for call-site aliases;
 * `"direct"` is accepted only by the parser (maps to `xai`).
 */
export type ProposerTransportPreference = ProposerProviderPreference | "direct";
/**
 * Portal → Core request header for per-org (or per-request) provider choice.
 * Values: `xai` | `moonshot` | `anthropic` | `openrouter`, plus legacy
 * `direct` (→ xai) and aliases `grok` / `kimi`. Unknown / absent → no overlay.
 */
export declare const PROPOSER_TRANSPORT_HEADER = "x-usesteady-proposer-transport";
/** When set by org overlay, selected provider is fail-closed (no cross-R6). */
export declare const PROPOSER_ORG_PIN_ENV = "USESTEADY_PROPOSER_ORG_PIN";
export type ProposerModelCall = (system: string, user: string) => Promise<string | null>;
export type CreateProposerModelCallOptions = {
    readonly maxTokens: number;
    /** Override env for tests. */
    readonly env?: NodeJS.ProcessEnv;
    /** Injectable Anthropic messages.create for unit tests. */
    readonly _anthropicCreate?: (args: {
        readonly model: string;
        readonly max_tokens: number;
        readonly system: string;
        readonly messages: readonly {
            readonly role: "user";
            readonly content: string;
        }[];
    }) => Promise<{
        content: readonly {
            type: string;
            text?: string;
        }[];
    }>;
    /** Injectable OpenAI chat.completions.create for unit tests (xAI + Moonshot + OpenRouter). */
    readonly _openaiCreate?: (args: {
        readonly model: string;
        readonly max_tokens: number;
        readonly messages: readonly {
            readonly role: "system" | "user";
            readonly content: string;
        }[];
    }) => Promise<{
        choices: readonly {
            message?: {
                content?: string | null;
            };
        }[];
    }>;
};
/**
 * Resolve the preferred proposer provider / transport.
 *
 * - unset / `xai` / `grok` / unknown → `xai` (Direct product default)
 * - `moonshot` / `kimi` → Moonshot/Kimi (explicit Direct override)
 * - `anthropic` → Anthropic Haiku-class (explicit Direct override)
 * - `openrouter` (PROVIDER or TRANSPORT) → OpenRouter gateway (optional Hybrid)
 *
 * Explicit Direct overrides (`anthropic` / `moonshot` / `kimi` / `xai` /
 * `grok`) beat TRANSPORT=openrouter so orgs cannot accidentally claim gateway
 * while forcing a Direct provider id.
 */
export declare function resolveProposerProvider(env?: NodeJS.ProcessEnv): ProposerProvider;
/**
 * Parse Portal / harness provider preference. Accepts named providers plus
 * legacy `direct` (→ xai) and aliases. Unknown → absent (no overlay).
 */
export declare function parseProposerProviderPreference(raw: unknown): ProposerProviderPreference | null;
/**
 * @deprecated Prefer `parseProposerProviderPreference`. Returns normalized
 * provider ids (`direct` header → `xai`).
 */
export declare function parseProposerTransportPreference(raw: unknown): ProposerProviderPreference | null;
/**
 * Overlay process env with an org provider preference for one propose call.
 *
 * - absent / null → return `base` unchanged (today's default)
 * - named provider → set PROVIDER (+ clear conflicting TRANSPORT); set
 *   `USESTEADY_PROPOSER_ORG_PIN=1` so the path is fail-closed (no silent
 *   cross-provider R6 while claiming another — INV-RP-GW-1 honesty)
 *
 * Does not move authority; keys remain process-scoped (Render / operator).
 */
export declare function envWithProposerProviderPreference(base: NodeJS.ProcessEnv, preference: ProposerProviderPreference | null | undefined): NodeJS.ProcessEnv;
/**
 * @deprecated Prefer `envWithProposerProviderPreference`. Accepts legacy
 * `"direct"` via the parser path only; callers should pass provider ids.
 */
export declare function envWithProposerTransportPreference(base: NodeJS.ProcessEnv, preference: ProposerTransportPreference | null | undefined): NodeJS.ProcessEnv;
/** Resolve request-scoped env from the transport / provider preference header. */
export declare function envFromProposerTransportHeader(headerValue: unknown, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Runtime metadata label for work-item records (not authorship provenance). */
export declare function proposerRuntimeLabel(env?: NodeJS.ProcessEnv): string;
/**
 * True when a usable key exists for the preferred provider, or for an R6
 * fallback on the default / moonshot paths (process-level only).
 *
 * OpenRouter is always fail-closed: only `OPENROUTER_API_KEY` counts.
 * Org-pinned preferences (`USESTEADY_PROPOSER_ORG_PIN`) are also fail-closed
 * for the selected provider key only — no silent wrong-provider R6 claim.
 */
export declare function isProposerProviderConfigured(env?: NodeJS.ProcessEnv): boolean;
/**
 * R6 — operational failures only. Empty/successful-but-null content is NOT
 * a fallback trigger (that would be a silent quality swap).
 */
export declare function isOperationalProposerFailure(err: unknown): boolean;
/**
 * Create a bounded (system, user) → text|null model call for proposer seams.
 * Direct xAI/Grok default: one attempt, then R6 Moonshot (then Anthropic) on
 * operational failure only. Explicit moonshot: Moonshot + Anthropic R6.
 * Explicit anthropic: Anthropic only.
 * Explicit openrouter: OpenRouter only — fail-closed, no Direct R6.
 *
 * Org-pinned preferences (header overlay): fail-closed on the selected
 * provider only — no cross-provider R6 while claiming another.
 */
export declare function createProposerModelCall(options: CreateProposerModelCallOptions): ProposerModelCall;
/**
 * Build a proposer call for one HTTP request using the transport preference
 * header. Portal / harness pass `X-UseSteady-Proposer-Transport`.
 */
export declare function createProposerModelCallFromTransportHeader(maxTokens: number, headerValue: unknown, base?: NodeJS.ProcessEnv): ProposerModelCall;
//# sourceMappingURL=proposer-model-call.d.ts.map