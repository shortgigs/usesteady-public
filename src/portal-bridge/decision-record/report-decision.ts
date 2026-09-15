/**
 * Decision Record Bridge (DECISION_RECORD_BRIDGE_V1) - orchestrator.
 *
 * `reportDecisionToPortal` is the single best-effort entry point the kernel's
 * mounting layer (server.ts) wires as a `reporter` after a FINAL is persisted. It:
 *   1. Resolves the opt-in (DEFAULT OFF) from env.
 *   2. Maps the record to the wire payload (pure).
 *   3. POSTs it (validate-first, never-throws).
 *
 * It NEVER throws and returns a structured result so the caller can log it. A
 * disabled or failed report can never affect the ratified decision (side-channel).
 */

import type { GovernedDecisionRecord } from "../../governed-decision/types.js";

import { decisionRecordFromGoverned, type DecisionRecordLinks } from "./build-payload.js";
import { resolveDecisionReporting, type DecisionReportingDisabledReason } from "./opt-in.js";
import { sendDecisionRecord, type SendResult } from "./transport.js";

export type ReportDecisionResult =
  | { readonly reported: false; readonly reason: DecisionReportingDisabledReason | string }
  | { readonly reported: true; readonly send: SendResult };

export type ReportDecisionOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly links?: DecisionRecordLinks;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

/**
 * Best-effort emit of one governed FINAL record to the Portal. Resolves opt-in,
 * builds the payload, and sends. Never throws.
 */
export async function reportDecisionToPortal(
  record: GovernedDecisionRecord,
  opts: ReportDecisionOptions = {},
): Promise<ReportDecisionResult> {
  try {
    const config = resolveDecisionReporting({ ...(opts.env !== undefined ? { env: opts.env } : {}) });
    if (!config.enabled) return { reported: false, reason: config.reason };

    const payload = decisionRecordFromGoverned(record, opts.links ?? {});
    const send = await sendDecisionRecord(payload, {
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
