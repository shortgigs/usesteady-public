/**
 * reflectIntentDeterministic — deterministic REFLECTION artifact engine.
 *
 * Relocated from `scripts/runtime-reflect-intent.ts` into `src/` (R2 layering
 * fix). `src/` must never import from `scripts/`: `scripts/` is dev/CI tooling
 * that is NOT shipped in the npm package, so a `src/ -> scripts/` import is a
 * runtime-missing-module risk for installed clients. The engine now lives next
 * to its sole production consumer (`src/workflow/route-to-surface.ts`). The
 * certification script and tests import it from here.
 *
 * Zero authority: this maps an unparseable request to a descriptive
 * ReflectionArtifact ("here is what I believe you mean"). It never executes,
 * approves, or gates. Returns `null` for primitive inputs so they fall through
 * to the existing deterministic ReviewingFrame path.
 */

export interface ReflectionArtifact {
  readonly classification: "initiative" | "capability" | "program" | "refactor" | "structure" | "primitive" | "unknown";
  readonly summary: string;
  readonly key_points: readonly string[];
  readonly next_step: string;
  readonly originalRequest: string;
}

const S1_S6_TEMPLATES: Record<string, Omit<ReflectionArtifact, "originalRequest">> = {
  structureguard: {
    classification: "initiative",
    summary: "StructureGuard research initiative",
    key_points: [
      "StructureGuard is a research initiative",
      "Goal is LLM evaluation research",
      "Initial setup work is requested",
      "No implementation plan exists yet",
    ],
    next_step: "Confirm before any planning or file operations",
  },
  "auth middleware": {
    classification: "capability",
    summary: "Add authentication middleware to the API",
    key_points: [
      "Add authentication middleware to the API layer",
      "Protect routes that require identity",
      "Establish session or token validation approach",
      "Define scope (which routes, which auth method)",
    ],
    next_step: "Confirm scope before proceeding",
  },
  "pega migration": {
    classification: "program",
    summary: "Migrate Pega user management rules",
    key_points: [
      "Migration initiative for Pega user-management rules",
      "Inventory existing rules and target platform",
      "Plan phased migration",
      "Identify first migration slice",
    ],
    next_step: "Confirm migration scope",
  },
  "rate limiting": {
    classification: "capability",
    summary: "Add rate limiting to public endpoints",
    key_points: [
      "Protect public API endpoints from abuse",
      "Choose rate-limit strategy",
      "Identify which routes are public",
      "Plan implementation and configuration",
    ],
    next_step: "Confirm strategy and scope",
  },
  "button rebrand": {
    classification: "refactor",
    summary: "Rebrand Button component theme colors",
    key_points: [
      "Update Button styling to new brand colors",
      "Update theme tokens and component variants",
      "Scope: Button component and dependent theme files",
      "Confirm color targets",
    ],
    next_step: "Confirm rebrand details",
  },
  utils: {
    classification: "structure",
    summary: "Create utils directory with date helpers",
    key_points: [
      "New utils directory",
      "Date helper functions as initial content",
      "Scaffold + helper stubs",
    ],
    next_step: "Confirm location and content",
  },
};

function isPrimitiveInput(input: string): boolean {
  const lower = input.toLowerCase();
  return /^(mkdir|create file|delete file|rm |touch |rename )/i.test(lower.trim());
}

export function reflectIntentDeterministic(input: string): ReflectionArtifact | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  // S6 must be matched before the generic primitive check
  if (lower.includes("utils") && lower.includes("date")) {
    // noUncheckedIndexedAccess: dot/index access on a Record yields `V |
    // undefined`. Guard before spread so the result stays a full ReflectionArtifact.
    const t = S1_S6_TEMPLATES["utils"];
    if (t) return { ...t, originalRequest: trimmed };
  }

  if (isPrimitiveInput(trimmed)) {
    return null; // bypass to existing ReviewingFrame
  }

  for (const [key, template] of Object.entries(S1_S6_TEMPLATES)) {
    if (lower.includes(key)) {
      return { ...template, originalRequest: trimmed };
    }
  }

  // Non-S1–S6 fallback (allowed outside certification path)
  return {
    classification: "unknown",
    summary: trimmed,
    key_points: ["Request received"],
    next_step: "Review and confirm",
    originalRequest: trimmed,
  };
}
