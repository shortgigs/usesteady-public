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
import type { IntentInterpreter } from "../types.js";
export declare const configIntentInterpreter: IntentInterpreter;
//# sourceMappingURL=config-intent.interpreter.d.ts.map