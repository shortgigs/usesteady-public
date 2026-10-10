/**
 * Executor half of the certification adapter.
 *
 * The executor holds the WRITE-capable credential (service_role). It performs
 * exactly one atomic conditional set-to-value per invocation — no retries, no
 * background work, no self-certification:
 *
 *   SET field = expectedTargetValue, revision = expectedNextRevision
 *   WHERE id = rowId AND revision = expectedPriorRevision
 *
 * What it returns is INVOCATION EVIDENCE ONLY (ack ≠ reality):
 *
 *   - the operation it attempted (reconciled against the binding downstream)
 *   - the HTTP outcome classification of each attempt
 *
 * The executor never observes reality and never emits a verdict. Even an
 * ack_success — HTTP 2xx with the post-state row in the representation — is
 * executor-provided post-state evidence and remains non-authoritative. Only
 * the separately authorized observer readback establishes reality evidence.
 *
 * Structural credential guard: this module refuses any credential whose class
 * is not "executor_service_role". That guard is defense-in-depth ONLY — the
 * real authority boundary is database-enforced (the anon observer credential
 * is physically incapable of the write; case J proves it live).
 */

import { postgrestCasWrite, PostgrestTransportError, type FetchLike } from "./postgrest.js";
import type { ApiCredential, ApiWriteBinding, ApiWriteInvocation } from "./types.js";

export type ApiWriteAttemptResult = {
  readonly operation: {
    readonly table: string;
    readonly rowId: string;
    readonly set: { readonly field: string; readonly revision: number };
    readonly predicate: { readonly rowId: string; readonly revision: number };
  };
  readonly attempts: readonly ApiWriteInvocation[];
};

export async function executeSupabaseScratchWrite(
  binding: ApiWriteBinding,
  cred: ApiCredential,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<ApiWriteAttemptResult> {
  if (cred.class !== "executor_service_role") {
    throw new Error(
      `executor credential required (got ${cred.class}) — authority separation is structural`,
    );
  }

  const operation = {
    table: binding.table,
    rowId: binding.rowId,
    set: {
      field: binding.expectedTargetValue,
      revision: binding.expectedNextRevision,
    },
    predicate: {
      rowId: binding.rowId,
      revision: binding.expectedPriorRevision,
    },
  };

  const at = now().toISOString();
  try {
    const res = await postgrestCasWrite(
      cred,
      binding.table,
      binding.rowId,
      binding.expectedPriorRevision,
      binding.expectedTargetValue,
      binding.expectedNextRevision,
      fetchImpl,
    );
    const is2xx = res.status >= 200 && res.status < 300;
    const invocation: ApiWriteInvocation = is2xx
      ? res.rowsReturned === 1
        ? {
            attempt: 1,
            at,
            httpStatus: res.status,
            ack: "ack_success",
            rowsReturned: 1,
            detail:
              "HTTP 2xx; representation carried the bound post-state row (invocation evidence only — not reality)",
          }
        : {
            attempt: 1,
            at,
            httpStatus: res.status,
            ack: "ack_refused",
            rowsReturned: res.rowsReturned ?? 0,
            detail:
              "HTTP 2xx with zero rows — the revision predicate did not hold; nothing was written",
          }
      : {
          attempt: 1,
          at,
          httpStatus: res.status,
          ack: "ack_error",
          rowsReturned: null,
          detail: `HTTP ${res.status} — the request was rejected`,
        };
    return { operation, attempts: [invocation] };
  } catch (err) {
    if (err instanceof PostgrestTransportError) {
      return {
        operation,
        attempts: [
          {
            attempt: 1,
            at,
            httpStatus: null,
            ack: "ack_lost",
            rowsReturned: null,
            detail:
              "transport failure — the write outcome is unknowable from executor vantage (the mutation may or may not have committed)",
          },
        ],
      };
    }
    throw err;
  }
}
