/**
 * Executor half of the KV certification adapter.
 *
 * The executor holds the WRITE-capable credential (executor_kv_edit — a
 * Cloudflare API token with Workers KV Storage Edit). It performs exactly one
 * UNCONDITIONAL set-to-value PUT per invocation — no retries, no background
 * work, no self-certification:
 *
 *   PUT <key> = { field: expectedTargetValue, revision: expectedNextRevision,
 *                 note: expectedWitnessValue }
 *
 * ── NO-CAS CAVEAT (load-bearing) ─────────────────────────────────────────────
 *
 *   The PUT is unconditional last-write-wins: KV evaluates no predicate, so
 *   the write applies even if the observed prior revision has moved on. There
 *   is NO `ack_refused` class here — on PostgREST a 2xx with zero rows meant
 *   "the CAS predicate did not hold; nothing was written"; KV has no
 *   server-side predicate and therefore no server-side refusal. The absence
 *   of ack_refused is the type-level signature of the lost CAS. A 2xx means
 *   only "an unconditional write was accepted" — never "the write applied to
 *   the observed prior revision".
 *
 * What it returns is INVOCATION EVIDENCE ONLY (ack ≠ reality):
 *
 *   - the operation it attempted (reconciled against the binding downstream)
 *   - the HTTP outcome classification of the attempt
 *
 * The executor never observes reality and never emits a verdict. Even an
 * ack_success is executor-provided post-state evidence and remains
 * non-authoritative. Only the separately authorized observer readback
 * establishes reality evidence.
 *
 * Structural credential guard: this module refuses any credential whose class
 * is not "executor_kv_edit". That guard is defense-in-depth ONLY — the real
 * authority boundary is API-token-enforced (the read-only observer token is
 * refused by the Cloudflare API; case J proves it live).
 */

import { kvPutValue, KvTransportError, type FetchLike } from "./kv.js";
import type {
  KvCredential,
  KvWriteBinding,
  KvWriteInvocation,
} from "./kv-types.js";

export type KvWriteAttemptResult = {
  readonly operation: {
    readonly namespaceId: string;
    readonly key: string;
    readonly set: { readonly field: string; readonly revision: number };
    readonly unconditional: true;
  };
  readonly attempts: readonly KvWriteInvocation[];
};

export async function executeKvScratchWrite(
  binding: KvWriteBinding,
  cred: KvCredential,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<KvWriteAttemptResult> {
  if (cred.class !== "executor_kv_edit") {
    throw new Error(
      `executor credential required (got ${cred.class}) — authority separation is structural`,
    );
  }

  const operation = {
    namespaceId: binding.namespaceId,
    key: binding.key,
    set: {
      field: binding.expectedTargetValue,
      revision: binding.expectedNextRevision,
    },
    // The structural record of the lost CAS: no predicate is evaluated.
    unconditional: true as const,
  };

  const at = now().toISOString();
  try {
    const res = await kvPutValue(
      cred,
      binding.namespaceId,
      binding.key,
      {
        field: binding.expectedTargetValue,
        revision: binding.expectedNextRevision,
        note: binding.expectedWitnessValue,
      },
      fetchImpl,
    );
    const is2xx = res.status >= 200 && res.status < 300;
    const invocation: KvWriteInvocation = is2xx
      ? {
          attempt: 1,
          at,
          httpStatus: res.status,
          ack: "ack_success",
          detail:
            "HTTP 2xx — the UNCONDITIONAL write was accepted (invocation evidence only — not reality; KV evaluates no predicate, so 2xx cannot mean 'applied to the observed prior revision')",
        }
      : {
          attempt: 1,
          at,
          httpStatus: res.status,
          ack: "ack_error",
          detail:
            res.status === 429
              ? "HTTP 429 — rate limited; a transport pacing event, never consistency evidence"
              : `HTTP ${res.status} — the request was rejected`,
        };
    return { operation, attempts: [invocation] };
  } catch (err) {
    if (err instanceof KvTransportError) {
      return {
        operation,
        attempts: [
          {
            attempt: 1,
            at,
            httpStatus: null,
            ack: "ack_lost",
            detail:
              "transport failure — the write outcome is unknowable from executor vantage (the mutation may or may not have committed)",
          },
        ],
      };
    }
    throw err;
  }
}
