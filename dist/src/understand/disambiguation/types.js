/**
 * Intent Disambiguation types.
 *
 * Disambiguation identifies whether an input has a single clear meaning
 * or multiple competing interpretations.
 *
 * Results:
 *   clear      — single unambiguous meaning; normalized form provided
 *   ambiguous  — multiple valid interpretations; bounded options provided
 *   unknown    — no registered detector matched; no interpretation available
 *
 * Detectors may NOT silently rewrite input. If ambiguous, they MUST return options.
 */
export {};
//# sourceMappingURL=types.js.map