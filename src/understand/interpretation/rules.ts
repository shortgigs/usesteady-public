/**
 * Interpretation rules — v1.
 *
 * Three categories are implemented:
 *   1. Tailwind color change  (priority 10) — most specific, deterministic
 *   2. CSS color change       (priority 20) — hex / rgb / hsl / CSS property
 *   3. Config value change    (priority 30) — config files or value patterns
 *   4. Text literal change    (priority 40) — human-readable UI copy
 *
 * Priority order matters: a Tailwind class could also look like a text literal
 * if rule ordering were reversed. The most specific rule must run first.
 */

import type { InterpretationResult, InterpretationRule, ReplaceChange } from "./types.js";
type ParsedChange = ReplaceChange;
import { basename } from "./parser.js";

// ─── Utilities ────────────────────────────────────────────────────────────────

const TAILWIND_COLOR_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|" +
  "transparent|current|inherit";

const TAILWIND_PREFIXES =
  "bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|caret|accent";

const TAILWIND_COLOR_RE = new RegExp(
  `\\b(?:${TAILWIND_PREFIXES})-(?:${TAILWIND_COLOR_NAMES})(?:-\\d+)?\\b`,
  "i",
);

const TAILWIND_PREFIX_LABELS: Readonly<Record<string, string>> = {
  bg:      "background color",
  text:    "text color",
  border:  "border color",
  ring:    "ring / focus color",
  from:    "gradient start color",
  to:      "gradient end color",
  via:     "gradient midpoint color",
  fill:    "fill color",
  stroke:  "stroke color",
  shadow:  "shadow color",
  outline: "outline color",
  caret:   "caret color",
  accent:  "accent color",
};

function tailwindColorClass(value: string): string | null {
  return TAILWIND_COLOR_RE.exec(value)?.[0] ?? null;
}

function tailwindPrefix(cls: string): string {
  const prefix = /^([a-z]+)-/i.exec(cls)?.[1]?.toLowerCase();
  return prefix !== undefined
    ? (TAILWIND_PREFIX_LABELS[prefix] ?? "color")
    : "color";
}

// CSS color patterns
const CSS_COLOR_VALUE_RE =
  /#[0-9a-fA-F]{3,8}\b|rgb\s*\(|rgba\s*\(|hsl\s*\(|hsla\s*\(/i;

const CSS_NAMED_COLOR_RE =
  /\b(?:red|blue|green|yellow|white|black|orange|purple|pink|gray|grey|cyan|magenta|lime|coral|teal|navy|maroon|olive|silver|gold)\b/i;

const CSS_PROPERTY_RE =
  /\b(?:color|background-color|background|border-color|fill|stroke)\s*:/i;

const CSS_FILE_RE = /\.(css|scss|sass|less|styl)$/i;

function isCssColor(value: string): boolean {
  return (
    CSS_COLOR_VALUE_RE.test(value) ||
    CSS_NAMED_COLOR_RE.test(value) ||
    CSS_PROPERTY_RE.test(value)
  );
}

// Config file / value patterns
const CONFIG_FILE_RE =
  /\.(json|yaml|yml|toml|env|ini|properties|conf|config)$/i;

const CONFIG_FILE_NAME_RE =
  /(?:config|settings|env|rc)\.[a-z]+$/i;

const CONFIG_VALUE_RE =
  /^\d+$|^https?:\/\/|^(true|false)$/i;

function isConfigFile(filePath?: string): boolean {
  if (filePath === undefined) return false;
  return CONFIG_FILE_RE.test(filePath) || CONFIG_FILE_NAME_RE.test(filePath);
}

function isConfigValue(value: string): boolean {
  return CONFIG_VALUE_RE.test(value);
}

// Text literal heuristic
const TEXT_LITERAL_RE = /^[a-zA-Z][a-zA-Z0-9\s.,!?:;'\-/()\[\]]*$/;
const CODE_NOISE_RE   = /[{}<>@#$%^&*=_\\|`~]/;

// Matches all-lowercase single tokens — utility classes, state names, event names,
// design tokens, CSS property identifiers. These are code, not human UI copy.
// Examples: flex, block, hidden, submit, disabled, primary, error, bg-cover, text-sm
const LOWERCASE_TOKEN_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// Tailwind/CSS fraction utilities: w-1/2, h-2/3, inset-1/2
// The "/" between numbers is a strong code token indicator.
const CSS_FRACTION_RE = /^[a-z-]*\d+\/\d+$/i;

// CSS property declarations: "margin: 16px", "font-size: 14px", "z-index: 10"
// A word (possibly hyphenated) followed by a colon is a CSS property, not UI text.
const CSS_PROPERTY_DECL_RE = /^[a-z][a-z-]*\s*:/i;

function isTextLiteral(value: string): boolean {
  if (!TEXT_LITERAL_RE.test(value)) return false;
  if (CODE_NOISE_RE.test(value)) return false;
  if (value.length < 2 || value.length > 120) return false;

  // Exclude lowercase-only tokens — code identifiers, not human UI copy.
  // Text literals must either start uppercase OR be multi-word phrases.
  if (LOWERCASE_TOKEN_RE.test(value)) return false;

  // Exclude Tailwind/CSS fractional utilities like w-1/2, h-2/3.
  if (CSS_FRACTION_RE.test(value)) return false;

  // Exclude CSS property declarations like "margin: 16px", "font-size: 14px".
  if (CSS_PROPERTY_DECL_RE.test(value)) return false;

  return true;
}

// ─── Rule 1: Tailwind color change ────────────────────────────────────────────

export const tailwindColorRule: InterpretationRule = {
  id: "tailwind_color_change",
  priority: 10,

  matches(parsed): boolean {
    return (
      tailwindColorClass(parsed.oldValue) !== null ||
      tailwindColorClass(parsed.newValue) !== null
    );
  },

  interpret(parsed): InterpretationResult | null {
    const oldCls = tailwindColorClass(parsed.oldValue);
    const newCls = tailwindColorClass(parsed.newValue);
    if (oldCls === null && newCls === null) return null;

    const property = tailwindPrefix(oldCls ?? newCls ?? "");
    const fileLabel = parsed.filePath !== undefined
      ? ` in ${basename(parsed.filePath)}`
      : "";

    return {
      category:   "tailwind_color_change",
      summary:    `Changes ${property} from '${parsed.oldValue}' to '${parsed.newValue}'${fileLabel}.`,
      impact:     [
        "Visual change only — no logic, data, or behavior impact.",
        `Affects rendered ${property}.`,
        "Verify in browser after applying.",
      ],
      confidence: "high",
    };
  },
};

// ─── Rule 2: CSS color change ─────────────────────────────────────────────────
// NOTE: File extension alone is NOT sufficient — .css files contain many non-color
// properties (width, margin, font-size, z-index, etc.). We only fire when the
// old or new value actually contains color-indicating content.

export const cssColorRule: InterpretationRule = {
  id: "css_color_change",
  priority: 20,

  matches(parsed): boolean {
    return isCssColor(parsed.oldValue) || isCssColor(parsed.newValue);
  },

  interpret(parsed): InterpretationResult | null {
    // Determine confidence: high if CSS property declaration is present,
    // medium if only a color value or file-extension match.
    const hasPropertyDecl =
      CSS_PROPERTY_RE.test(parsed.oldValue) ||
      CSS_PROPERTY_RE.test(parsed.newValue);

    const fileLabel = parsed.filePath !== undefined
      ? ` in ${basename(parsed.filePath)}`
      : "";

    return {
      category:   "css_color_change",
      summary:    `Changes CSS color value from '${parsed.oldValue}' to '${parsed.newValue}'${fileLabel}.`,
      impact:     [
        "Visual change only — no logic, data, or behavior impact.",
        "Verify rendered result in browser after applying.",
      ],
      confidence: hasPropertyDecl ? "high" : "medium",
    };
  },
};

// ─── Rule 3: Config value change ──────────────────────────────────────────────

export const configValueRule: InterpretationRule = {
  id: "config_value_change",
  priority: 30,

  matches(parsed): boolean {
    return (
      isConfigFile(parsed.filePath) ||
      (isConfigValue(parsed.oldValue) && isConfigValue(parsed.newValue))
    );
  },

  interpret(parsed): InterpretationResult | null {
    const fileLabel = parsed.filePath !== undefined
      ? ` in ${basename(parsed.filePath)}`
      : "";

    // Produce tailored impact hints for known value shapes.
    const impact: string[] = [
      `Configuration change: '${parsed.oldValue}' → '${parsed.newValue}'.`,
    ];

    if (/^\d+$/.test(parsed.oldValue) && /^\d+$/.test(parsed.newValue)) {
      // "may affect port, timeout, or limit" removed — too speculative without key context
      impact.push("Numeric value change — verify all usages of this value have been updated.");
    } else if (
      /^https?:\/\//.test(parsed.oldValue) ||
      /^https?:\/\//.test(parsed.newValue)
    ) {
      // "endpoint" removed — implies API server without proof
      impact.push("URL value change — verify the new address is correct and reachable.");
    } else if (/^(true|false)$/i.test(parsed.oldValue)) {
      impact.push("Boolean flag change — may toggle a feature or mode.");
    }

    return {
      category:   "config_value_change",
      summary:    `Changes configuration value from '${parsed.oldValue}' to '${parsed.newValue}'${fileLabel}.`,
      impact,
      confidence: isConfigFile(parsed.filePath) ? "high" : "medium",
    };
  },
};

// ─── Rule 4: Text literal change ──────────────────────────────────────────────

export const textLiteralRule: InterpretationRule = {
  id: "text_literal_change",
  priority: 40,

  matches(parsed): boolean {
    return isTextLiteral(parsed.oldValue) || isTextLiteral(parsed.newValue);
  },

  interpret(parsed): InterpretationResult | null {
    const fileLabel = parsed.filePath !== undefined
      ? ` in ${basename(parsed.filePath)}`
      : "";

    return {
      category:   "text_literal_change",
      summary:    `Changes text '${parsed.oldValue}' to '${parsed.newValue}'${fileLabel}.`,
      impact:     [
        "User-visible text change.",
        "No logic, data, or behavior impact.",
        "Review for consistency with other UI copy if this label appears elsewhere.",
      ],
      confidence: "medium",
    };
  },
};

// ─── Ordered registry ─────────────────────────────────────────────────────────

export const ALL_INTERPRETATION_RULES: ReadonlyArray<InterpretationRule> = [
  tailwindColorRule,
  cssColorRule,
  configValueRule,
  textLiteralRule,
].sort((a, b) => a.priority - b.priority);
