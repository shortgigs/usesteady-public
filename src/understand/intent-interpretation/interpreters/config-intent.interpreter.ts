/**
 * Config intent interpreter.
 *
 * Scope: detect inputs that appear to be feature flags, toggles, or configuration
 * value changes. Priority 10 — runs before color/text to prevent "toggle dark mode"
 * being misclassified as a color change.
 *
 * Strong verbs (always config-like regardless of noun):
 *   toggle, enable, disable, activate, deactivate
 *
 * Config nouns (trigger even with generic verbs like "set" / "change"):
 *   timeout, port, flag, config, configuration, env, environment, variable, feature, debug, logging
 *
 * Out of scope: general UI state like "disable the button" is borderline,
 * but v1 errs toward config_change when a strong config verb is present.
 * Confidence is "medium" throughout — the bridge never claims certainty.
 */

import type { IntentInterpreter, IntentInterpretation } from "../types.js";

const STRONG_CONFIG_VERBS_RE =
  /\b(toggle|enable|disable|activate|deactivate)\b/i;

/**
 * Config noun patterns — deliberately narrow to prevent false positives.
 *
 * ── Precision fixes (Sessions 4–5) ────────────────────────────────────────────
 *
 *   Removed standalone "feature":
 *     "launch the new feature" was incorrectly firing config_change.
 *     "feature" alone is too broad — it matches product ops, not only config.
 *
 *   Removed standalone "flag":
 *     "flag any user with N failed logins" incorrectly fired config_change.
 *     "flag" as a user-labeling verb is not config work.
 *
 *   Added "feature[\s-]flag" as a compound phrase:
 *     The original intent — catching "update the feature flag" — is preserved.
 *     "toggle/enable/disable the flag" still fires via STRONG_CONFIG_VERBS_RE.
 *
 * ── Precision fix (Session 6) ─────────────────────────────────────────────────
 *
 *   Removed standalone "debug":
 *     "debug the authentication error" / "debug the service mesh" incorrectly fired
 *     config_change because "debug" as a bare noun matched CONFIG_NOUNS_RE.
 *     Session 6 confirmed this fires across 4/4 diagnostic inputs, 3 personas — a
 *     systematic false positive, not an edge case.
 *
 *   Added "debug[\s-](?:mode|log(?:ging)?|level|flag)" as a compound phrase:
 *     "debug mode for the API server" and "debug logging" are legitimate config work
 *     and must continue to fire. The compound catches these without absorbing
 *     diagnostic-verb uses like "debug the X" (where X is a problem or system).
 *
 *   "enable debug logging" still fires:
 *     The strong verb "enable" matches STRONG_CONFIG_VERBS_RE independently, so
 *     removing bare "debug" does not break the strong-verb path.
 */
const CONFIG_NOUNS_RE =
  /\b(?:timeout|port|config(?:uration)?|env(?:ironment)?|variable|logging)\b|\bfeature[\s-]flag\b|\bdebug[\s-](?:mode|log(?:ging)?|level|flag)\b/i;

export const configIntentInterpreter: IntentInterpreter = {
  id: "config_intent",
  priority: 10,

  matches(input): boolean {
    return STRONG_CONFIG_VERBS_RE.test(input) || CONFIG_NOUNS_RE.test(input);
  },

  interpret(input): IntentInterpretation | null {
    const basis: string[] = [];

    const verbMatch = STRONG_CONFIG_VERBS_RE.exec(input);
    if (verbMatch !== null) {
      basis.push(`matched config verb: ${verbMatch[1]}`);
    }

    const nounMatch = CONFIG_NOUNS_RE.exec(input);
    if (nounMatch !== null) {
      basis.push(`matched config keyword: ${nounMatch[1]}`);
    }

    if (basis.length === 0) return null;

    return {
      category:   "config_change",
      summary:    "This appears to be a configuration change request.",
      confidence: "medium",
      basis,
    };
  },
};
