/**
 * Intent Reflection v1 — deterministic understanding artifact before decomposition.
 * USESTEADY_INTENT_REFLECTION_IMPLEMENTATION_V1 — no LLM, no new entities.
 */

export type IntentUnderstandingArtifact = {
  readonly format: "usesteady.intent-understanding-artifact.v1";
  readonly bullets: readonly string[];
  readonly confirmationPrompt: string;
  readonly rawInput: string;
};

export type IntentReflectionResult =
  | { readonly ok: true; readonly artifact: IntentUnderstandingArtifact }
  | { readonly ok: false; readonly code: "empty_intent" | "no_reflection"; readonly message: string };

const CONFIRMATION_PROMPT = "Is this correct?";

function artifact(rawInput: string, bullets: readonly string[]): IntentUnderstandingArtifact {
  return {
    format: "usesteady.intent-understanding-artifact.v1",
    bullets,
    confirmationPrompt: CONFIRMATION_PROMPT,
    rawInput,
  };
}

function extractInitiativeName(text: string): string | null {
  const createMatch = text.match(
    /\b(?:create|start|launch|set up|setup)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*){0,3})\s+(?:research\s+)?(?:initiative|project)\b/i,
  );
  if (createMatch?.[1]) {
    return createMatch[1].trim();
  }

  const namedMatch = text.match(/\b([A-Za-z][A-Za-z0-9_-]*)\s+(?:research\s+)?(?:initiative|project)\b/i);
  if (namedMatch?.[1]) {
    return namedMatch[1].trim();
  }

  return null;
}

function reflectStructureGuard(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\bstructure\s*guard\b/i.test(trimmed)) {
    return null;
  }

  return artifact(trimmed, [
    "StructureGuard is a research initiative",
    "Goal is LLM evaluation research",
    "Initial setup work is requested",
    "No implementation plan exists yet",
  ]);
}

function reflectResearchInitiative(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\b(research\s+(initiative|project)|(?:initiative|project)\s+for\s+\w+)\b/i.test(trimmed)) {
    return null;
  }

  const name = extractInitiativeName(trimmed);
  if (!name) {
    return null;
  }

  return artifact(trimmed, [
    `${name} is a research initiative`,
    "Goal is LLM evaluation research",
    "Initial setup work is requested",
    "No implementation plan exists yet",
  ]);
}

function reflectAuthMiddleware(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\b(auth(?:entication)?\s+middleware|middleware\s+for\s+(?:the\s+)?api)\b/i.test(trimmed)) {
    return null;
  }

  return artifact(trimmed, [
    "Add authentication middleware to the API layer",
    "Protect routes that require identity",
    "Establish session or token validation approach",
    "Define scope (which routes, which auth method)",
  ]);
}

function reflectPegaMigration(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\bpega\b/i.test(trimmed) || !/\b(migrat|user[- ]management|rules)\b/i.test(trimmed)) {
    return null;
  }

  return artifact(trimmed, [
    "Migration initiative for Pega user-management rules",
    "Inventory existing rules and target platform",
    "Plan phased migration (not one-shot file edit)",
    "Identify first migration slice",
  ]);
}

function reflectRateLimiting(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\brate\s*limit/i.test(trimmed) || !/\b(public|endpoint|api)\b/i.test(trimmed)) {
    return null;
  }

  return artifact(trimmed, [
    "Protect public API endpoints from abuse",
    "Choose rate-limit strategy (per-IP, per-key, etc.)",
    'Identify which routes are "public"',
    "Plan implementation and configuration",
  ]);
}

function reflectThemeRebrand(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\b(rebrand|theme|color)\b/i.test(trimmed) || !/\bbutton\b/i.test(trimmed)) {
    return null;
  }

  return artifact(trimmed, [
    "Update Button styling to new brand colors",
    "Likely touches theme tokens and component variants",
    "Scope: Button component and dependent theme files",
    "Confirm color target or design source",
  ]);
}

function reflectUtilsDirectory(trimmed: string): IntentUnderstandingArtifact | null {
  if (!/\b(utils?|utilities?)\b/i.test(trimmed) || !/\b(date|helper)\b/i.test(trimmed)) {
    return null;
  }

  return artifact(trimmed, [
    "New utils (or similar) directory",
    "Date helper functions as initial content",
    "Clarify language/location if ambiguous",
    "First deliverable: scaffold + helper stubs",
  ]);
}

const REFLECTORS: readonly ((intent: string) => IntentUnderstandingArtifact | null)[] = [
  reflectStructureGuard,
  reflectResearchInitiative,
  reflectAuthMiddleware,
  reflectPegaMigration,
  reflectRateLimiting,
  reflectThemeRebrand,
  reflectUtilsDirectory,
];

/**
 * First-turn partner path: when no template matches, still return a reviewable
 * artifact from the operator's own words (never invent facts). Avoids HTTP 422
 * noise on session one while keeping templates preferred when they match.
 */
export function reflectVerbatimFallback(trimmed: string): IntentUnderstandingArtifact {
  const parts = trimmed
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const source = parts.length > 0 ? parts : [trimmed];
  const bullets = source.slice(0, 4).map((s) =>
    s.length > 200 ? `${s.slice(0, 197)}...` : s,
  );
  return artifact(trimmed, bullets);
}

/**
 * Build a reviewable understanding artifact for initiative-level intents.
 * Returns null when no template matches (caller may use verbatim fallback).
 */
export function buildIntentUnderstandingArtifact(intent: string): IntentUnderstandingArtifact | null {
  const trimmed = intent.trim();
  if (!trimmed) {
    return null;
  }

  for (const reflect of REFLECTORS) {
    const result = reflect(trimmed);
    if (result) {
      return result;
    }
  }

  return null;
}

/** Portal-facing reflect-intent API shape. */
export function reflectIntentUnderstanding(intent: string): IntentReflectionResult {
  const trimmed = intent.trim();
  if (!trimmed) {
    return { ok: false, code: "empty_intent", message: "Intent is required." };
  }

  const built =
    buildIntentUnderstandingArtifact(trimmed) ?? reflectVerbatimFallback(trimmed);

  return { ok: true, artifact: built };
}
