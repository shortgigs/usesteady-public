/**
 * Kernel v1 / K6 -- bounded `node -e` inline JS classifier.
 *
 * -- Scope (K6 design doc v1.0 sections 3, 5, 6) ------------------------------
 *
 *   Pure structural predicate over the inline-JS BODY extracted from a
 *   `node -e "<BODY>"` command. Returns true iff BODY belongs to the closed
 *   K6 allow-list of provably deterministic JS source shapes. Returns false
 *   for ALL other inputs.
 *
 *   The K6 admitted forms (v1.0 LOCKED -- design doc section 5.2):
 *     - Form 1: console.log("<literal>")   [DQ JS string; no escapes]
 *     - Form 2: console.log('<literal>')   [SQ JS string; no escapes]
 *     - Form 3: console.log(<integer>)     [signed; up to 15 digits]
 *     - Form 4: console.log(true|false)    [exact-token]
 *     - Form 5: console.log(null)          [exact-token]
 *
 *   The five regexes (design doc section 5.2):
 *     ^console\.log\("([^"\\]*)"\)$
 *     ^console\.log\('([^'\\]*)'\)$
 *     ^console\.log\(-?(?:0|[1-9][0-9]{0,14})\)$
 *     ^console\.log\((?:true|false)\)$
 *     ^console\.log\(null\)$
 *
 * -- Two-gate decision (design doc section 5.1) -------------------------------
 *
 *   Gate A -- inline-JS denylist (token + syntax, defense in depth, K6-I4).
 *     Operates on the raw trimmed BODY. If ANY denied token (section 6.1) or
 *     denied syntax fragment (section 6.2) is present, refuse on sight.
 *
 *   Gate B -- inline-JS allow-list. The trimmed BODY (with an optional
 *     trailing semicolon and surrounding whitespace stripped) must match
 *     exactly one of the five regexes above.
 *
 *   Failure at either gate -> BODY is non-replayable. The caller surfaces
 *   this as `reason: "non_deterministic_inline_js"` on the verdict
 *   (design doc section 10).
 *
 * -- Why two gates instead of one regex (design doc section 6.4) --------------
 *
 *   The denylist is intentionally over-inclusive. Any token in the denylist
 *   that appears outside one of the five allow-list forms is, by
 *   construction, in a refused body anyway -- the allow-list regex would
 *   not have matched. The denylist's job is defense in depth: it refuses
 *   the body BEFORE the allow-list runs, so a malformed-but-allow-list-
 *   matching body (regex flaw) is caught upstream. This mirrors K5's
 *   two-gate path-containment model and inherits the K5 Appendix A
 *   discipline ("explicit universe, default-deny, additive growth").
 *
 *   False positives in the denylist (e.g. an admitted form happens to
 *   contain the substring `process` inside a string literal) are
 *   ACCEPTABLE by design (K6-I4 inherited from K5-I13). This is not a
 *   usability regression; operators can express the same intent without
 *   the substring.
 *
 * -- The unenumerated bypass (design doc section 11.10) -----------------------
 *
 *   The denylist + allow-list cannot prove the predicate is bypass-free for
 *   EVERY possible body. The mitigation is the closed-set discipline: the
 *   allow-list admits ONLY five exact regex shapes, and any body that
 *   doesn't literally match one of them refuses regardless of the denylist
 *   result. The denylist is defense in depth; the allow-list is the
 *   primary safety. If an unanticipated bypass is discovered after this
 *   implementation lands, the response is to TIGHTEN the allow-list (NOT
 *   relax it), add a denylist entry as defense in depth, and ship a
 *   follow-up. The K6 contract does not promise a provably-empty bypass
 *   set; it promises a closed-set discipline.
 *
 * -- Purity contract (K6-I2 / K6-I3) ------------------------------------------
 *
 *   Pure function. No I/O. No imports. Does NOT parse the body as
 *   JavaScript. Does NOT load a JS AST library. Does NOT call
 *   `vm.compileFunction`, `vm.runInContext`, or any similar primitive.
 *   It is a structural string predicate only.
 */
/**
 * True iff `body` is in the K6 admitted-inline-JS allow-list.
 *
 * Non-strings, empty strings, and all-whitespace strings all return false
 * (K6-I4 default-deny posture, inherited from K5-I13).
 *
 * The body is trimmed before classification. An optional trailing semicolon
 * is stripped (the design doc section 5.1 admits one).
 *
 * Pure function. No I/O. No imports outside this module.
 */
export declare function isReplayableInlineJsShape(body: unknown): boolean;
/**
 * True iff the body contains any token from the K6 inline-JS token denylist
 * (section 6.1). Case-sensitive substring match. Over-inclusive by design.
 *
 * @internal -- exposed only for the K6 unit test suite, which verifies the
 * denylist surface explicitly per the design doc's section 12.1 test plan.
 */
export declare function containsDeniedInlineJsToken(body: string): boolean;
/**
 * True iff the body contains any syntax fragment from the K6 inline-JS
 * syntax denylist (section 6.2). Includes brackets, braces, backticks,
 * comments, escapes, optional chaining, arrow, spread, and template
 * substitution.
 *
 * @internal -- same as `containsDeniedInlineJsToken`.
 */
export declare function containsDeniedInlineJsSyntax(body: string): boolean;
/**
 * True iff `command` matches the K6 prefix probe (whole-command shape
 * `node -e "<BODY>"` exactly, per design doc section 3 D1).
 *
 * Pure function. Used by the K5 router in command-classifier.ts to decide
 * whether the K6 path applies BEFORE the K5 SHELL_METACHARACTERS denylist
 * runs on the whole command (the K5 denylist forbids `"`, which the K6
 * path needs).
 */
export declare function isK6NodeECommandShape(command: unknown): boolean;
/**
 * Extract the BODY string from a K6 `node -e "<BODY>"` command. Returns
 * `null` if the command does not match the K6 prefix.
 *
 * The returned body is the raw extracted string -- it is NOT yet classified.
 * The caller must pass it through `isReplayableInlineJsShape` to confirm
 * structural determinism.
 *
 * Pure function.
 */
export declare function extractK6Body(command: unknown): string | null;
//# sourceMappingURL=inline-js-classifier.d.ts.map