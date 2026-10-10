/**
 * Portal bearer auth for governed-handoff routes (W-E1).
 * Validates Authorization: Bearer against USESTEADY_PORTAL_TOKEN (server-only).
 */

import { timingSafeEqual } from "node:crypto";

export function readPortalBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function validatePortalBearerToken(provided: string | null): boolean {
  const expected = process.env["USESTEADY_PORTAL_TOKEN"]?.trim() ?? "";
  if (expected.length === 0 || provided === null || provided.length === 0) {
    return false;
  }
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function portalHandoffAuthFailure(): { status: number; body: Record<string, string> } {
  return {
    status: 401,
    body: { error: "unauthorized", message: "Valid portal bearer token required." },
  };
}

export function portalHandoffUnavailable(reason: string): { status: number; body: Record<string, string> } {
  return {
    status: 503,
    body: { error: "handoff_unavailable", message: reason },
  };
}
