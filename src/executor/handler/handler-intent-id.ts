/**
 * Deterministic handler intent identity — no timestamps (INV-HAND-8).
 */

import { createHash } from "node:crypto";

export function handlerIntentId(input: {
  readonly execution_id: string;
  readonly capability_id: string;
  readonly capability_handler_id: string;
  readonly intent_summary: string;
}): string {
  const payload = [
    input.execution_id.trim(),
    input.capability_id.trim(),
    input.capability_handler_id.trim(),
    input.intent_summary.trim(),
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}
