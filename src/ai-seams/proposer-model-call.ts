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

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// ─── Defaults (INV-AI-5 — bounded cheap tier) ─────────────────────────────────

/** Default Anthropic proposer model (Haiku-class) — override / secondary R6. */
export const DEFAULT_ANTHROPIC_PROPOSER_MODEL = "claude-haiku-4-5";

/**
 * Default Moonshot proposer model — Kimi flagship chat id (2026-07-18).
 * Explicit override / R6 fallback for the Grok product default.
 * Pin via USESTEADY_MOONSHOT_MODEL=kimi-k3.
 */
export const DEFAULT_MOONSHOT_PROPOSER_MODEL = "kimi-k3";

/** International Moonshot OpenAI-compatible base URL. */
export const DEFAULT_MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";

/**
 * Default xAI / Grok proposer model — matches delivery-path GROK_MODEL default
 * in src/shell/cli/main.ts. Pin in prod via USESTEADY_XAI_MODEL (or GROK_MODEL).
 */
export const DEFAULT_XAI_PROPOSER_MODEL = "grok-3";

/** xAI OpenAI-compatible base URL. */
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

/**
 * Default OpenRouter model — Grok via OpenRouter slug (prefer Direct for cost;
 * this is the optional gateway pin only). Pin via USESTEADY_OPENROUTER_MODEL.
 * OpenRouter deprecated `x-ai/grok-3` (404); catalog pin is grok-4.3.
 * Direct xAI default remains `grok-3` (DEFAULT_XAI_PROPOSER_MODEL) — unchanged.
 */
export const DEFAULT_OPENROUTER_PROPOSER_MODEL = "x-ai/grok-4.3";

/** OpenRouter OpenAI-compatible base URL. */
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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
export type ProposerProviderPreference =
  | "xai"
  | "moonshot"
  | "anthropic"
  | "openrouter";

/**
 * @deprecated Use `ProposerProviderPreference`. Kept for call-site aliases;
 * `"direct"` is accepted only by the parser (maps to `xai`).
 */
export type ProposerTransportPreference =
  | ProposerProviderPreference
  | "direct";

/**
 * Portal → Core request header for per-org (or per-request) provider choice.
 * Values: `xai` | `moonshot` | `anthropic` | `openrouter`, plus legacy
 * `direct` (→ xai) and aliases `grok` / `kimi`. Unknown / absent → no overlay.
 */
export const PROPOSER_TRANSPORT_HEADER = "x-usesteady-proposer-transport";

/** When set by org overlay, selected provider is fail-closed (no cross-R6). */
export const PROPOSER_ORG_PIN_ENV = "USESTEADY_PROPOSER_ORG_PIN";

export type ProposerModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

export type CreateProposerModelCallOptions = {
  readonly maxTokens: number;
  /** Override env for tests. */
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable Anthropic messages.create for unit tests. */
  readonly _anthropicCreate?: (args: {
    readonly model: string;
    readonly max_tokens: number;
    readonly system: string;
    readonly messages: readonly { readonly role: "user"; readonly content: string }[];
  }) => Promise<{ content: readonly { type: string; text?: string }[] }>;
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
      message?: { content?: string | null };
    }[];
  }>;
};

// ─── Provider resolution ──────────────────────────────────────────────────────

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
export function resolveProposerProvider(
  env: NodeJS.ProcessEnv = process.env,
): ProposerProvider {
  const raw = (env["USESTEADY_PROPOSER_PROVIDER"] ?? "").trim().toLowerCase();
  const transport = (env["USESTEADY_PROPOSER_TRANSPORT"] ?? "")
    .trim()
    .toLowerCase();
  if (raw === "anthropic") return "anthropic";
  if (raw === "moonshot" || raw === "kimi") return "moonshot";
  if (raw === "openrouter") return "openrouter";
  if (raw === "xai" || raw === "grok") return "xai";
  if (transport === "openrouter") return "openrouter";
  return "xai";
}

/**
 * Parse Portal / harness provider preference. Accepts named providers plus
 * legacy `direct` (→ xai) and aliases. Unknown → absent (no overlay).
 */
export function parseProposerProviderPreference(
  raw: unknown,
): ProposerProviderPreference | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "xai" || v === "direct" || v === "grok") return "xai";
  if (v === "moonshot" || v === "kimi") return "moonshot";
  if (v === "anthropic") return "anthropic";
  if (v === "openrouter") return "openrouter";
  return null;
}

/**
 * @deprecated Prefer `parseProposerProviderPreference`. Returns normalized
 * provider ids (`direct` header → `xai`).
 */
export function parseProposerTransportPreference(
  raw: unknown,
): ProposerProviderPreference | null {
  return parseProposerProviderPreference(raw);
}

function isOrgPinned(env: NodeJS.ProcessEnv): boolean {
  const raw = (env[PROPOSER_ORG_PIN_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

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
export function envWithProposerProviderPreference(
  base: NodeJS.ProcessEnv,
  preference: ProposerProviderPreference | null | undefined,
): NodeJS.ProcessEnv {
  if (preference == null) return base;

  const next: NodeJS.ProcessEnv = {
    ...base,
    [PROPOSER_ORG_PIN_ENV]: "1",
    USESTEADY_PROPOSER_TRANSPORT: "",
  };

  if (preference === "openrouter") {
    next["USESTEADY_PROPOSER_PROVIDER"] = "openrouter";
    return next;
  }

  if (preference === "moonshot") {
    next["USESTEADY_PROPOSER_PROVIDER"] = "moonshot";
    return next;
  }

  if (preference === "anthropic") {
    next["USESTEADY_PROPOSER_PROVIDER"] = "anthropic";
    return next;
  }

  // xai (includes legacy direct) — pin Direct Grok; clear gateway hijack.
  next["USESTEADY_PROPOSER_PROVIDER"] = "xai";
  return next;
}

/**
 * @deprecated Prefer `envWithProposerProviderPreference`. Accepts legacy
 * `"direct"` via the parser path only; callers should pass provider ids.
 */
export function envWithProposerTransportPreference(
  base: NodeJS.ProcessEnv,
  preference: ProposerTransportPreference | null | undefined,
): NodeJS.ProcessEnv {
  if (preference == null) return base;
  const normalized =
    preference === "direct"
      ? ("xai" as const)
      : parseProposerProviderPreference(preference);
  return envWithProposerProviderPreference(base, normalized);
}

/** Resolve request-scoped env from the transport / provider preference header. */
export function envFromProposerTransportHeader(
  headerValue: unknown,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return envWithProposerProviderPreference(
    base,
    parseProposerProviderPreference(headerValue),
  );
}


/** Runtime metadata label for work-item records (not authorship provenance). */
export function proposerRuntimeLabel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const provider = resolveProposerProvider(env);
  if (provider === "anthropic") {
    return DEFAULT_ANTHROPIC_PROPOSER_MODEL;
  }
  if (provider === "moonshot") {
    const model =
      env["USESTEADY_MOONSHOT_MODEL"]?.trim() || DEFAULT_MOONSHOT_PROPOSER_MODEL;
    return `moonshot:${model}`;
  }
  if (provider === "openrouter") {
    return `openrouter:${openrouterModel(env)}`;
  }
  const model = xaiModel(env);
  return `xai:${model}`;
}

function moonshotApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const key =
    env["MOONSHOT_API_KEY"]?.trim() || env["KIMI_API_KEY"]?.trim() || "";
  return key.length > 0 ? key : undefined;
}

function xaiApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = env["XAI_API_KEY"]?.trim() || "";
  return key.length > 0 ? key : undefined;
}

function anthropicApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = env["ANTHROPIC_API_KEY"]?.trim() || "";
  return key.length > 0 ? key : undefined;
}

function openrouterApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = env["OPENROUTER_API_KEY"]?.trim() || "";
  return key.length > 0 ? key : undefined;
}

/**
 * True when a usable key exists for the preferred provider, or for an R6
 * fallback on the default / moonshot paths (process-level only).
 *
 * OpenRouter is always fail-closed: only `OPENROUTER_API_KEY` counts.
 * Org-pinned preferences (`USESTEADY_PROPOSER_ORG_PIN`) are also fail-closed
 * for the selected provider key only — no silent wrong-provider R6 claim.
 */
export function isProposerProviderConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const provider = resolveProposerProvider(env);
  const pinned = isOrgPinned(env);
  if (provider === "anthropic") {
    return anthropicApiKey(env) !== undefined;
  }
  if (provider === "moonshot") {
    if (pinned) return moonshotApiKey(env) !== undefined;
    return (
      moonshotApiKey(env) !== undefined || anthropicApiKey(env) !== undefined
    );
  }
  if (provider === "openrouter") {
    return openrouterApiKey(env) !== undefined;
  }
  // Product default (xAI Direct): Grok key, or Moonshot / Anthropic R6 keys —
  // unless org-pinned to Grok (then only XAI_API_KEY).
  if (pinned) return xaiApiKey(env) !== undefined;
  return (
    xaiApiKey(env) !== undefined ||
    moonshotApiKey(env) !== undefined ||
    anthropicApiKey(env) !== undefined
  );
}

function moonshotBaseURL(env: NodeJS.ProcessEnv): string {
  const raw = env["USESTEADY_MOONSHOT_BASE_URL"]?.trim();
  if (raw && raw.length > 0) return raw.replace(/\/+$/, "");
  return DEFAULT_MOONSHOT_BASE_URL;
}

function moonshotModel(env: NodeJS.ProcessEnv): string {
  return env["USESTEADY_MOONSHOT_MODEL"]?.trim() || DEFAULT_MOONSHOT_PROPOSER_MODEL;
}

function xaiBaseURL(env: NodeJS.ProcessEnv): string {
  const raw =
    env["USESTEADY_XAI_BASE_URL"]?.trim() || env["XAI_BASE_URL"]?.trim();
  if (raw && raw.length > 0) return raw.replace(/\/+$/, "");
  return DEFAULT_XAI_BASE_URL;
}

function xaiModel(env: NodeJS.ProcessEnv): string {
  return (
    env["USESTEADY_XAI_MODEL"]?.trim() ||
    env["GROK_MODEL"]?.trim() ||
    DEFAULT_XAI_PROPOSER_MODEL
  );
}

function openrouterBaseURL(env: NodeJS.ProcessEnv): string {
  const raw =
    env["USESTEADY_OPENROUTER_BASE_URL"]?.trim() ||
    env["OPENROUTER_BASE_URL"]?.trim();
  if (raw && raw.length > 0) return raw.replace(/\/+$/, "");
  return DEFAULT_OPENROUTER_BASE_URL;
}

function openrouterModel(env: NodeJS.ProcessEnv): string {
  return (
    env["USESTEADY_OPENROUTER_MODEL"]?.trim() ||
    DEFAULT_OPENROUTER_PROPOSER_MODEL
  );
}

/**
 * R6 — operational failures only. Empty/successful-but-null content is NOT
 * a fallback trigger (that would be a silent quality swap).
 */
export function isOperationalProposerFailure(err: unknown): boolean {
  if (err == null) return true; // missing key / unavailable treated as operational

  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : NaN;
  if (status === 401 || status === 403 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;

  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "string"
        ? err.toLowerCase()
        : String(err).toLowerCase();

  if (
    /timeout|timed out|etimedout|econnreset|econnrefused|enotfound|network|socket hang up|fetch failed/.test(
      msg,
    )
  ) {
    return true;
  }
  if (/\b429\b|rate limit|too many requests/.test(msg)) return true;
  if (/\b401\b|\b403\b|unauthorized|forbidden|authentication|invalid api key/.test(msg)) {
    return true;
  }
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable/.test(msg)) {
    return true;
  }
  // Missing-key paths use dedicated sentinel strings from the factory.
  if (
    msg === "moonshot_key_missing" ||
    msg === "xai_key_missing" ||
    msg === "openrouter_key_missing"
  ) {
    return true;
  }

  return false;
}

async function callAnthropic(
  options: CreateProposerModelCallOptions,
  env: NodeJS.ProcessEnv,
  system: string,
  user: string,
): Promise<string | null> {
  const apiKey = anthropicApiKey(env);
  if (!apiKey) return null;
  const maxTokens = options.maxTokens;

  try {
    if (options._anthropicCreate) {
      const message = await options._anthropicCreate({
        model: DEFAULT_ANTHROPIC_PROPOSER_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      });
      const block = message.content[0];
      if (!block || block.type !== "text" || typeof block.text !== "string") {
        return null;
      }
      return block.text;
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: DEFAULT_ANTHROPIC_PROPOSER_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = message.content[0];
    if (!block || block.type !== "text") return null;
    return block.text;
  } catch {
    return null;
  }
}

type OpenAiCompatResult = {
  readonly text: string | null;
  readonly operationalFailure: boolean;
};

async function callOpenAiCompatible(
  options: CreateProposerModelCallOptions,
  args: {
    readonly apiKey: string | undefined;
    readonly baseURL: string;
    readonly model: string;
    readonly missingKeySentinel: string;
    readonly defaultHeaders?: Readonly<Record<string, string>>;
  },
  system: string,
  user: string,
): Promise<OpenAiCompatResult> {
  if (!args.apiKey) {
    return { text: null, operationalFailure: true };
  }
  const maxTokens = options.maxTokens;

  try {
    if (options._openaiCreate) {
      const completion = await options._openaiCreate({
        model: args.model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const text = completion.choices[0]?.message?.content;
      // Successful HTTP with empty content → fail-closed, no quality fallback.
      return {
        text: typeof text === "string" && text.length > 0 ? text : null,
        operationalFailure: false,
      };
    }

    const client = new OpenAI({
      apiKey: args.apiKey,
      baseURL: args.baseURL,
      timeout: 30_000,
      ...(args.defaultHeaders
        ? { defaultHeaders: { ...args.defaultHeaders } }
        : {}),
    });
    const completion = await client.chat.completions.create({
      model: args.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const text = completion.choices[0]?.message?.content;
    return {
      text: typeof text === "string" && text.length > 0 ? text : null,
      operationalFailure: false,
    };
  } catch (err) {
    return {
      text: null,
      operationalFailure: isOperationalProposerFailure(err),
    };
  }
}

async function callXai(
  options: CreateProposerModelCallOptions,
  env: NodeJS.ProcessEnv,
  system: string,
  user: string,
): Promise<OpenAiCompatResult> {
  return callOpenAiCompatible(
    options,
    {
      apiKey: xaiApiKey(env),
      baseURL: xaiBaseURL(env),
      model: xaiModel(env),
      missingKeySentinel: "xai_key_missing",
    },
    system,
    user,
  );
}

async function callMoonshot(
  options: CreateProposerModelCallOptions,
  env: NodeJS.ProcessEnv,
  system: string,
  user: string,
): Promise<OpenAiCompatResult> {
  return callOpenAiCompatible(
    options,
    {
      apiKey: moonshotApiKey(env),
      baseURL: moonshotBaseURL(env),
      model: moonshotModel(env),
      missingKeySentinel: "moonshot_key_missing",
    },
    system,
    user,
  );
}

/**
 * OpenRouter gateway path (INV-RP-GW-1 — transport only, zero authority).
 * Fail-closed: no R6 to Direct providers (would fake gateway attribution).
 */
async function callOpenRouter(
  options: CreateProposerModelCallOptions,
  env: NodeJS.ProcessEnv,
  system: string,
  user: string,
): Promise<OpenAiCompatResult> {
  const referer =
    env["USESTEADY_OPENROUTER_HTTP_REFERER"]?.trim() ||
    "https://usesteady.dev";
  const title = env["USESTEADY_OPENROUTER_APP_TITLE"]?.trim() || "UseSteady";
  return callOpenAiCompatible(
    options,
    {
      apiKey: openrouterApiKey(env),
      baseURL: openrouterBaseURL(env),
      model: openrouterModel(env),
      missingKeySentinel: "openrouter_key_missing",
      defaultHeaders: {
        "HTTP-Referer": referer,
        "X-Title": title,
      },
    },
    system,
    user,
  );
}

/** R6 for Moonshot path: Anthropic only on operational failure. */
async function moonshotWithAnthropicFallback(
  options: CreateProposerModelCallOptions,
  env: NodeJS.ProcessEnv,
  system: string,
  user: string,
): Promise<string | null> {
  const primary = await callMoonshot(options, env, system, user);
  if (primary.text !== null) return primary.text;
  if (primary.operationalFailure && anthropicApiKey(env)) {
    return callAnthropic(options, env, system, user);
  }
  return null;
}

/**
 * R6 for product-default xAI path: Moonshot first, then Anthropic when
 * Moonshot is missing or also operationally failed. Never after empty success.
 */
async function xaiWithFallbacks(
  options: CreateProposerModelCallOptions,
  env: NodeJS.ProcessEnv,
  system: string,
  user: string,
): Promise<string | null> {
  const primary = await callXai(options, env, system, user);
  if (primary.text !== null) return primary.text;
  if (!primary.operationalFailure) return null;

  if (moonshotApiKey(env)) {
    const moonshot = await callMoonshot(options, env, system, user);
    if (moonshot.text !== null) return moonshot.text;
    if (moonshot.operationalFailure && anthropicApiKey(env)) {
      return callAnthropic(options, env, system, user);
    }
    return null;
  }

  if (anthropicApiKey(env)) {
    return callAnthropic(options, env, system, user);
  }
  return null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

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
export function createProposerModelCall(
  options: CreateProposerModelCallOptions,
): ProposerModelCall {
  const env = options.env ?? process.env;
  const provider = resolveProposerProvider(env);
  const pinned = isOrgPinned(env);

  if (provider === "anthropic") {
    return async (system, user) => callAnthropic(options, env, system, user);
  }

  if (provider === "moonshot") {
    if (pinned) {
      return async (system, user) => {
        const result = await callMoonshot(options, env, system, user);
        return result.text;
      };
    }
    return async (system, user) =>
      moonshotWithAnthropicFallback(options, env, system, user);
  }

  if (provider === "openrouter") {
    return async (system, user) => {
      const result = await callOpenRouter(options, env, system, user);
      return result.text;
    };
  }

  // Product default: Direct xAI/Grok — R6 unless org-pinned to Grok.
  if (pinned) {
    return async (system, user) => {
      const result = await callXai(options, env, system, user);
      return result.text;
    };
  }
  return async (system, user) => xaiWithFallbacks(options, env, system, user);
}

/**
 * Build a proposer call for one HTTP request using the transport preference
 * header. Portal / harness pass `X-UseSteady-Proposer-Transport`.
 */
export function createProposerModelCallFromTransportHeader(
  maxTokens: number,
  headerValue: unknown,
  base: NodeJS.ProcessEnv = process.env,
): ProposerModelCall {
  return createProposerModelCall({
    maxTokens,
    env: envFromProposerTransportHeader(headerValue, base),
  });
}
