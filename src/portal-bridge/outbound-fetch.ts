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

// Namespace import, NOT named imports: getCACertificates/setDefaultCACertificates
// only exist on Node 22+. A static named import crashes ESM instantiation on
// Node 20 (the production container) before the runtime guard below can run.
import * as tls from "node:tls";

const getCACertificates: ((kind?: string) => string[]) | undefined = (
  tls as Record<string, unknown>
)["getCACertificates"] as ((kind?: string) => string[]) | undefined;
const setDefaultCACertificates: ((certs: string[]) => void) | undefined = (
  tls as Record<string, unknown>
)["setDefaultCACertificates"] as ((certs: string[]) => void) | undefined;

export const OUTBOUND_SYSTEM_CA_ENV = "USESTEADY_OUTBOUND_SYSTEM_CA";

let outboundCaConfigured = false;

/** Idempotent. Safe to call before any portal-bridge HTTPS request. */
export function enableOutboundSystemCaIfNeeded(): void {
  if (outboundCaConfigured) return;

  const explicit = process.env[OUTBOUND_SYSTEM_CA_ENV]?.trim();
  if (explicit === "0") return;

  const shouldEnable =
    explicit === "1" || (explicit === undefined && process.platform === "win32");
  if (!shouldEnable) return;

  if (typeof getCACertificates !== "function" || typeof setDefaultCACertificates !== "function") {
    return;
  }

  try {
    const systemCerts = getCACertificates("system");
    setDefaultCACertificates(["default", ...systemCerts]);
    outboundCaConfigured = true;
  } catch {
    // Keep bundled CAs only; outbound HTTPS may still fail on corp TLS hosts.
  }
}

/** Default fetch for portal-bridge transport when no test double is injected. */
export function resolveOutboundFetch(override?: typeof fetch): typeof fetch {
  if (override) return override;
  enableOutboundSystemCaIfNeeded();
  return globalThis.fetch;
}
