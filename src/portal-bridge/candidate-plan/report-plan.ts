/**
 * Candidate Plan Bridge (P.S1) - orchestrator.
 *
 * `reportCandidatePlanToPortal` is the single best-effort entry point the
 * mounting layer (server.ts) wires as a `draftReporter`, fired AFTER a DRAFT is
 * durably persisted and therefore structurally BEFORE any ratification decision
 * exists (INV-PS1-1). It:
 *   1. Resolves the opt-in (DEFAULT OFF) from env.
 *   2. Maps the draft record to the wire payload (pure; null when there is no
 *      plan to store - nothing is emitted for a plan-less draft).
 *   3. POSTs it (validate-first, never-throws).
 *
 * It NEVER throws and returns a structured result so the caller can log it. A
 * disabled, skipped, or failed report can never affect the draft, the human's
 * review, or the later ratification (INV-PS1-2 - zero authority, side-channel).
 */

import type { GovernedDecisionRecord } from "../../governed-decision/types.js";

import { candidatePlanFromDraft, type CandidatePlanLinks } from "./build-payload.js";
import {
  resolveCandidatePlanReporting,
  type CandidatePlanReportingDisabledReason,
} from "./opt-in.js";
import { sendCandidatePlan, type SendResult } from "./transport.js";

export type ReportCandidatePlanResult =
  | { readonly reported: false; readonly reason: CandidatePlanReportingDisabledReason | "no_plan" | string }
  | { readonly reported: true; readonly send: SendResult };

export type ReportCandidatePlanOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly links?: CandidatePlanLinks;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
};

/**
 * Best-effort emit of one DRAFT's candidate plan to the Portal. Resolves
 * opt-in, builds the payload, and sends. Never throws.
 */
export async function reportCandidatePlanToPortal(
  record: GovernedDecisionRecord,
  opts: ReportCandidatePlanOptions = {},
): Promise<ReportCandidatePlanResult> {
  try {
    const config = resolveCandidatePlanReporting({
      ...(opts.env !== undefined ? { env: opts.env } : {}),
    });
    if (!config.enabled) return { reported: false, reason: config.reason };

    const payload = candidatePlanFromDraft(record, opts.links ?? {});
    if (payload === null) return { reported: false, reason: "no_plan" };

    const send = await sendCandidatePlan(payload, {
      url: config.url,
      token: config.token,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return { reported: true, send };
  } catch (err) {
    // Defensive: the mapper/transport are already non-throwing, but the side-
    // channel must NEVER surface an error to the draft path.
    return { reported: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
