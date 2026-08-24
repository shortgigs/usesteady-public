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
import type { SafetyDetector } from "../types.js";
export declare const secretAccessDetector: SafetyDetector;
//# sourceMappingURL=secret-access.detector.d.ts.map