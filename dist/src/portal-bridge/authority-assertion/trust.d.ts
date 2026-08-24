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
export declare const PORTAL_AUTHORITY_KEYS_ENV = "USESTEADY_PORTAL_AUTHORITY_KEYS";
export type PortalAuthorityTrust = {
    /** key_id -> base64 SPKI Ed25519 public key. */
    readonly keys: ReadonlyMap<string, string>;
};
export type PortalAuthorityTrustResolution = {
    readonly status: "not_configured";
} | {
    readonly status: "configured";
    readonly trust: PortalAuthorityTrust;
} | {
    readonly status: "misconfigured";
    readonly reason: string;
};
export declare function loadPortalAuthorityTrust(env?: Readonly<Record<string, string | undefined>>): PortalAuthorityTrustResolution;
//# sourceMappingURL=trust.d.ts.map