/**
 * Outbound HTTPS fetch for Portal/Core side-channels (Execution Return Bridge,
 * understand-workflow POST, Pending Approval Bridge).
 *
 * On Windows, Node's bundled trust store often omits corporate or Schannel-only
 * roots that PowerShell and curl.exe already trust. That surfaces as
 * `fetch failed` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` while Invoke-RestMethod
 * succeeds.
 *
 * We merge the OS certificate store into Node's default CAs at runtime via
 * `tls.getCACertificates("system")` (Node 22+). This avoids disabling
 * verification and does not require NODE_USE_SYSTEM_CA before process start.
 */
export declare const OUTBOUND_SYSTEM_CA_ENV = "USESTEADY_OUTBOUND_SYSTEM_CA";
/** Idempotent. Safe to call before any portal-bridge HTTPS request. */
export declare function enableOutboundSystemCaIfNeeded(): void;
/** Default fetch for portal-bridge transport when no test double is injected. */
export declare function resolveOutboundFetch(override?: typeof fetch): typeof fetch;
//# sourceMappingURL=outbound-fetch.d.ts.map