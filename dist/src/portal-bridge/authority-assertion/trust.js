/**
 * P1 Authority Assertion V1 — Core-side trust anchor (pinned Portal keys).
 *
 * CTO cryptographic contract: Core verifies authority assertions ONLY against
 * pre-trusted, out-of-band configured Portal public keys. A public key carried
 * inside a signed payload is diagnostic metadata and can never establish
 * authority — an attacker can generate their own Ed25519 keypair, sign a
 * fabricated approval, and attach their own public key.
 *
 * Configuration (Core environment):
 *   USESTEADY_PORTAL_AUTHORITY_KEYS='{"<key_id>":"<base64 SPKI Ed25519 public key>", ...}'
 *
 * Resolution semantics (fail-closed):
 *   - unset/empty            -> "not_configured"  (legacy behavior; everything
 *                              Portal-carried remains self-asserted)
 *   - present but unparseable / no valid entries
 *                            -> "misconfigured"   (treated as configured-but-
 *                              broken: callers MUST fail closed, never degrade
 *                              to legacy acceptance)
 *   - valid                  -> "configured"
 */
import { createPublicKey } from "node:crypto";
export const PORTAL_AUTHORITY_KEYS_ENV = "USESTEADY_PORTAL_AUTHORITY_KEYS";
function isValidEd25519SpkiBase64(value) {
    try {
        const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
        return key.asymmetricKeyType === "ed25519";
    }
    catch {
        return false;
    }
}
export function loadPortalAuthorityTrust(env = process.env) {
    const raw = env[PORTAL_AUTHORITY_KEYS_ENV]?.trim();
    if (!raw)
        return { status: "not_configured" };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        return {
            status: "misconfigured",
            reason: `${PORTAL_AUTHORITY_KEYS_ENV} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
            status: "misconfigured",
            reason: `${PORTAL_AUTHORITY_KEYS_ENV} must be a JSON object mapping key_id -> base64 SPKI public key`,
        };
    }
    const keys = new Map();
    for (const [keyId, value] of Object.entries(parsed)) {
        if (typeof value !== "string" || !isValidEd25519SpkiBase64(value)) {
            return {
                status: "misconfigured",
                reason: `${PORTAL_AUTHORITY_KEYS_ENV} entry "${keyId}" is not a base64 Ed25519 SPKI public key`,
            };
        }
        keys.set(keyId, value);
    }
    if (keys.size === 0) {
        return {
            status: "misconfigured",
            reason: `${PORTAL_AUTHORITY_KEYS_ENV} contains no key entries`,
        };
    }
    return { status: "configured", trust: { keys } };
}
//# sourceMappingURL=trust.js.map