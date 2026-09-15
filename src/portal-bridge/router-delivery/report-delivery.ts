/**
 * Router Delivery Bridge (D.S1) - orchestrator.
 *
 * `reportRouterDeliveryToPortal` is the single best-effort entry point the
 * mounting layer (server.ts) wires as a `deliveryReporter`, fired at the
 * Router's delivery moment - an APPROVED decision being handed to the
 * server-bound executor (INV-DS1-1; rejected decisions and executor-less
 * mounts never reach this path). It:
 *   1. Resolves the opt-in (DEFAULT OFF) from env.
 *   2. Maps the observed handoff facts to the wire payload (pure; null when a
 *      required fact is missing - nothing is emitted for an unknowable handoff).
 *   3. POSTs it (validate-first, never-throws).
 *
 * It NEVER throws and returns a structured result so the caller can log it. A
 * disabled, skipped, or failed report can never affect the ratification, the
 * execution, or the record (INV-DS1-2 - zero authority, side-channel). The
 * emitted record is a DELIVERY FACT, never a result: no verification surface
 * may consume it (INV-WL-1).
 */

import {
  routerDeliveryFromHandoff,
  type RouterDeliveryHandoff,
  type RouterDeliveryLinks,
} from "./build-payload.js";
import {
  resolveRouterDeliveryReporting,
  type RouterDeliveryReportingDisabledReason,
} from "./opt-in.js";
import { sendRouterDelivery, type SendResult } from "./transport.js";

export type ReportRouterDeliveryResult =
  | { readonly reported: false; readonly reason: RouterDeliveryReportingDisabledReason | "no_handoff" | string }
  | { readonly reported: true; readonly send: SendResult };

export type ReportRouterDeliveryOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly links?: RouterDeliveryLinks;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

/**
 * Best-effort emit of one handoff's delivery fact to the Portal. Resolves
 * opt-in, builds the payload, and sends. Never throws.
 */
export async function reportRouterDeliveryToPortal(
  handoff: RouterDeliveryHandoff,
  opts: ReportRouterDeliveryOptions = {},
): Promise<ReportRouterDeliveryResult> {
  try {
    const config = resolveRouterDeliveryReporting({
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
    if (!config.enabled) return { reported: false, reason: config.reason };

    const payload = routerDeliveryFromHandoff(handoff, opts.links ?? {});
    if (payload === null) return { reported: false, reason: "no_handoff" };

    const send = await sendRouterDelivery(payload, {
      url: config.url,
      token: config.token,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return { reported: true, send };
  } catch (err) {
    // Defensive: the mapper/transport are already non-throwing, but the side-
    // channel must NEVER surface an error to the ratification path.
    return { reported: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
