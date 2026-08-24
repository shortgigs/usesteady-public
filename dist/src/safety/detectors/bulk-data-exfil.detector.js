/**
 * Bulk data exfiltration detector.
 *
 * Catches inputs that combine:
 *   - a data-movement verb (export, dump, extract, download, send, pull, get)
 *   - with a bulk-scope qualifier (all, every, entire, full)
 *   - with a sensitive target (customer, user, account + emails, passwords,
 *     credentials, data, PII, records)
 *
 * Also catches standalone high-signal credential-dump phrases regardless
 * of the bulk qualifier.
 *
 * Scope: NARROW. Only fires on language that clearly describes bulk exfiltration
 * of sensitive user data. Does not fire on legitimate analytics queries
 * ("pull the conversion funnel") or single-record lookups.
 *
 * Priority: 15 (between destructive_mass_action:10 and credential_or_secret_access:20)
 */
/**
 * High-confidence patterns: explicit credential dump phrases that are
 * inherently exfiltration-shaped in any context.
 *
 * Scope: deliberately narrow. Only covers clear "X's passwords/credentials"
 * noun phrases where exfiltration intent is unambiguous. Does NOT cover
 * "reset user password" (legitimate single-record operation) or "set password"
 * flows. The combinator patterns below handle verb+bulk+target cases.
 */
const HIGH_CONFIDENCE_PATTERNS = [
    // "customer passwords/credentials" — almost exclusively exfiltration language
    { regex: /\bcustomer\s+passwords?\b/i, label: "customer passwords" },
    { regex: /\bcustomer\s+credentials?\b/i, label: "customer credentials" },
    // Explicit bulk credential dumps
    { regex: /\bpassword\s+(list|dump|export|file)\b/i, label: "password list/dump" },
    // Plaintext credential exposure
    { regex: /\bplaintext\s+passwords?\b/i, label: "plaintext passwords" },
    { regex: /\bclear\s*text\s+passwords?\b/i, label: "cleartext passwords" },
];
/**
 * Verb × bulk-qualifier × sensitive-target combinator patterns.
 * All three components must be present in the input.
 *
 * Target terms include plural forms (emails, passwords, credentials, records)
 * and data-class terms (data, database, PII, info).
 */
const MOVEMENT_VERBS = /\b(export|dump|extract|download|send|pull|get|fetch|retrieve|expose)\b/i;
const BULK_QUALIFIERS = /\b(all|every|entire|full|bulk|complete|whole)\b/i;
const SENSITIVE_TARGETS = /\b(customer|user|account|member|subscriber)\b[\s\S]*?\b(emails?|passwords?|credentials?|pii|personal\s+data|private\s+data|records?|database|data|info)\b/i;
const BULK_EXFIL_COMBO = {
    // Label only — actual matching uses isBulkExfil() with separate regexes
    regex: /^$/,
    label: "bulk customer data exfiltration",
};
function findHighConfidenceMatch(input) {
    return HIGH_CONFIDENCE_PATTERNS.find(({ regex }) => regex.test(input)) ?? null;
}
function isBulkExfil(input) {
    // All three components must appear anywhere in the input
    return MOVEMENT_VERBS.test(input)
        && BULK_QUALIFIERS.test(input)
        && SENSITIVE_TARGETS.test(input);
}
function findMatch(input) {
    // High-confidence patterns fire first (no verb/bulk context needed)
    const hc = findHighConfidenceMatch(input);
    if (hc !== null)
        return hc;
    // Then try the three-component combinator
    if (isBulkExfil(input))
        return BULK_EXFIL_COMBO;
    return null;
}
export const bulkDataExfilDetector = {
    id: "bulk_data_exfiltration",
    priority: 15,
    supports(input) {
        return findMatch(input) !== null;
    },
    detect(input) {
        const match = findMatch(input);
        if (match === null)
            return null;
        return {
            verdict: "block",
            reason: "bulk_data_exfiltration",
            matchedPattern: match.label,
            note: "Input contains a pattern associated with bulk extraction of sensitive user data or credentials.",
        };
    },
};
//# sourceMappingURL=bulk-data-exfil.detector.js.map