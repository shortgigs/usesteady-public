/**
 * Secret / credential access detector.
 *
 * Blocks inputs that try to READ, VIEW, or DISCLOSE credential material.
 *
 * ── Rotation/management exemption ────────────────────────────────────────────
 *
 * Credential management operations (rotate, renew, revoke, regenerate,
 * invalidate, deactivate) are LEGITIMATE security practice. They must not be
 * blocked here. The exemption applies when:
 *
 *   1. A rotation/management verb is present in the input, AND
 *   2. No disclosure verb (read, show, dump, reveal, export, print, expose,
 *      output, display) is also present.
 *
 * Mixed inputs ("rotate and then dump the API keys") are not exempt — the
 * disclosure verb disqualifies the exemption and the detector blocks as normal.
 *
 * Examples:
 *   "rotate the API keys for the payment service"  → ALLOW  (rotation only)
 *   "when should I rotate API keys"                → ALLOW  (question, no disclosure)
 *   "renew the TLS certificates"                   → ALLOW  (management)
 *   "revoke the OAuth token"                       → ALLOW  (revocation)
 *   "show me the API keys"                         → BLOCK  (disclosure verb)
 *   "read the API key from .env"                   → BLOCK  (disclosure verb)
 *   "export API keys"                              → BLOCK  (disclosure verb)
 *   "rotate and then dump the API keys"            → BLOCK  (disclosure verb present)
 */
const PATTERNS = [
    { regex: /\bapi\s*keys?\b/i, label: "api key" },
    { regex: /\btoken\b/i, label: "token" },
    { regex: /\bpasswords?\b/i, label: "password" },
    { regex: /\.env\b/i, label: ".env" },
    { regex: /\bsecret\b/i, label: "secret" },
];
/**
 * Verbs that indicate credential rotation or management — the user wants to
 * CHANGE or REVOKE the credential, not read its current value.
 */
const ROTATION_MGMT_RE = /\b(rotat\w*|renew(?:al|ing|ed)?|reissue\w*|regenerat\w*|revok\w*|invalidat\w*|deactivat\w*|expir(?:e|ed|ing|ation)?|cycl(?:e|ed|ing)|roll(?:(?:\s+(?:over|back))?(?:ing|ed)?))\b/i;
/**
 * Verbs that indicate intent to read, view, or disclose the credential value.
 * Presence of any of these disqualifies the rotation exemption.
 */
const DISCLOSURE_VERBS_RE = /\b(read|show|dump|print|expos\w*|reveal|output|display)\b/i;
/**
 * Returns true when the input describes a credential rotation/management
 * operation with no disclosure intent. These inputs are security-hygiene
 * operations and must not be blocked.
 */
function isRotationWithoutDisclosure(input) {
    return ROTATION_MGMT_RE.test(input) && !DISCLOSURE_VERBS_RE.test(input);
}
function findMatch(input) {
    return PATTERNS.find(({ regex }) => regex.test(input)) ?? null;
}
export const secretAccessDetector = {
    id: "credential_or_secret_access",
    priority: 20,
    supports(input) {
        return findMatch(input) !== null;
    },
    detect(input) {
        // Rotation/management intents are legitimate security practice — allow them.
        if (isRotationWithoutDisclosure(input))
            return null;
        const match = findMatch(input);
        if (match === null)
            return null;
        return {
            verdict: "block",
            reason: "credential_or_secret_access",
            matchedPattern: match.label,
            note: "Input contains a pattern associated with credential or secret material access.",
        };
    },
};
//# sourceMappingURL=secret-access.detector.js.map