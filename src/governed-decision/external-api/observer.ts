/**
 * Observer half of the certification adapter.
 *
 * The observer holds the READ-ONLY credential (anon key + RLS — the database
 * physically refuses its writes). It reads the exact resource identity, the
 * governed field, the revision, and the complete declared observation field
 * set, under a bounded convergence policy:
 *
 *   - finite read count (maxReads)
 *   - finite convergence deadline (deadlineMs)
 *   - deterministic linear backoff, every attempt timestamped
 *   - no unbounded polling, no background watcher
 *
 * Readback semantics (the exact rule — section 6 of the authorization):
 *
 *   AGREE     — observed row carries the expected target value AND the
 *               expected next revision AND the witness field is intact.
 *   DISAGREE  — the observed row AFFIRMATIVELY differs: wrong value,
 *               unexpected revision, prior value at a higher revision,
 *               a mutated witness field, or any other state that is neither
 *               the bound prior nor the bound post state.
 *   UNKNOWN   — the prior state is still observed when the convergence
 *               deadline is exhausted (a stale read is uncertainty, never
 *               contradiction), OR no successful row read was ever obtained
 *               (observer unavailable / malformed / unauthorized).
 *
 * The convergence deadline is a READ BUDGET, not an affirmative failure
 * condition. PostgREST reads and writes hit the same Postgres, so a read
 * that still shows the prior state means "the write is not (yet) visible",
 * never "the write failed". Exhausting the budget while only the prior
 * state is visible therefore yields UNKNOWN — uncertainty is preserved as
 * uncertainty and never silently upgraded into contradiction.
 */

import { postgrestReadRow, PostgrestTransportError, type FetchLike } from "./postgrest.js";
import type {
  ApiCredential,
  ApiObservation,
  ApiObservedRow,
  ApiReadAttempt,
  ApiWriteBinding,
} from "./types.js";

export type ApiReadPolicy = {
  /** Maximum number of read attempts (finite). */
  readonly maxReads: number;
  /** Convergence deadline in milliseconds from the first read (finite). */
  readonly deadlineMs: number;
  /** Base delay; attempt i (1-based) waits baseDelayMs * i before reading. */
  readonly baseDelayMs: number;
};

/**
 * The smallest policy justified by the live experiment. PostgREST is
 * read-after-write consistent on a single Postgres instance; the budget
 * exists to absorb transient observer unavailability, not replication lag.
 * The observed convergence distribution is reported in the certification.
 */
export const DEFAULT_READ_POLICY: ApiReadPolicy = {
  maxReads: 5,
  deadlineMs: 4000,
  baseDelayMs: 250,
};

/**
 * converge — post-actuation semantics: the prior state is INCONCLUSIVE (the
 *   write may not be visible yet), so reads retry within budget; prior state
 *   at deadline → unknown.
 * snapshot — pre-actuation semantics: the current state is the answer, so ANY
 *   successful row read is conclusive, including the prior state (which,
 *   relative to the approved post-state, is a disagreement — the approved
 *   state does not hold yet). Transient unavailability still retries.
 */
export type ObserverMode = "converge" | "snapshot";

type RowClassification =
  /** Bound post-state, witness intact. */
  | "post_agree"
  /** Bound post value+revision, but the witness field mutated — collateral. */
  | "post_collateral"
  /** Exactly the bound prior state (value, revision, witness). */
  | "prior"
  /** Affirmatively different from both the bound prior and the bound post. */
  | "other";

function isWellFormedRow(value: unknown): value is ApiObservedRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.field === "string" &&
    typeof row.revision === "number" &&
    typeof row.note === "string"
  );
}

function classifyRow(binding: ApiWriteBinding, row: ApiObservedRow): RowClassification {
  if (
    row.field === binding.expectedTargetValue &&
    row.revision === binding.expectedNextRevision
  ) {
    return row.note === binding.expectedWitnessValue ? "post_agree" : "post_collateral";
  }
  if (
    row.field === binding.expectedPriorValue &&
    row.revision === binding.expectedPriorRevision &&
    row.note === binding.expectedWitnessValue
  ) {
    return "prior";
  }
  return "other";
}

export async function observeSupabaseScratchRow(
  binding: ApiWriteBinding,
  cred: ApiCredential,
  fetchImpl: FetchLike,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
  policy: ApiReadPolicy = DEFAULT_READ_POLICY,
  mode: ObserverMode = "converge",
): Promise<ApiObservation> {
  if (cred.class !== "observer_anon") {
    throw new Error(
      `observer credential required (got ${cred.class}) — authority separation is structural`,
    );
  }

  const reads: ApiReadAttempt[] = [];
  const startedAt = now().getTime();
  let finalRow: ApiObservedRow | null = null;
  let terminal: "post_agree" | "post_collateral" | "prior" | "other" | null = null;
  let terminatedByUnauthorized = false;

  for (let attempt = 1; attempt <= policy.maxReads; attempt++) {
    if (attempt > 1) {
      await sleep(policy.baseDelayMs * (attempt - 1));
    }
    const at = now().toISOString();
    let attemptRecord: ApiReadAttempt;
    try {
      const res = await postgrestReadRow(
        cred,
        binding.table,
        binding.rowId,
        binding.observedFields,
        fetchImpl,
      );
      if (res.status === 401 || res.status === 403) {
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "unauthorized",
          detail: "observer credential rejected — reality cannot be established",
        };
        terminatedByUnauthorized = true;
      } else if (res.status >= 500) {
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "unavailable",
          detail: `HTTP ${res.status} — observer could not reach reality`,
        };
      } else if (res.status < 200 || res.status >= 300) {
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "malformed",
          detail: `HTTP ${res.status} — unexpected observer response`,
        };
      } else if (res.rows.length !== 1 || !isWellFormedRow(res.rows[0])) {
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "malformed",
          detail:
            res.rows.length === 0
              ? "no row for the bound identity — reality cannot be established"
              : "response did not carry the declared field set",
        };
      } else {
        const candidate: unknown = res.rows[0];
        if (!isWellFormedRow(candidate)) throw new Error("unreachable: guard above");
        // Project to the governed triple — the resource identity is bound by
        // the query; evidence records exactly the governed field, the
        // revision, and the witness.
        const row: ApiObservedRow = {
          field: candidate.field,
          revision: candidate.revision,
          note: candidate.note,
        };
        finalRow = row;
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "row",
          row,
          detail: "observed the bound row",
        };
        const classification = classifyRow(binding, row);
        if (classification !== "prior" || mode === "snapshot") {
          terminal = classification;
        }
      }
    } catch (err) {
      if (!(err instanceof PostgrestTransportError)) throw err;
      attemptRecord = {
        attempt,
        at,
        httpStatus: null,
        outcome: "unavailable",
        detail: "transport failure — observer could not reach reality",
      };
    }
    reads.push(attemptRecord);

    if (terminal !== null || terminatedByUnauthorized) break;
    if (now().getTime() - startedAt >= policy.deadlineMs) break;
  }

  const converged = terminal !== null;
  let realityVerdict: ApiObservation["realityVerdict"];
  let detail: string;
  if (terminal === "post_agree") {
    realityVerdict = "agree";
    detail = "observed the bound post-state with the witness field intact";
  } else if (terminal === "post_collateral") {
    realityVerdict = "disagree";
    detail =
      "observed the bound post value+revision but the witness field mutated — in-scope collateral";
  } else if (terminal === "other") {
    realityVerdict = "disagree";
    detail = "observed state affirmatively differs from both the bound prior and the bound post";
  } else if (terminal === "prior") {
    // Snapshot mode only: the current state is conclusively the bound prior —
    // relative to the approved post-state, a disagreement.
    realityVerdict = "disagree";
    detail = "observed the bound prior state — the approved post-state does not hold";
  } else if (finalRow !== null) {
    realityVerdict = "unknown";
    detail =
      "convergence deadline exhausted while only the prior state was visible — stale read preserved as uncertainty, never upgraded to a verdict";
  } else {
    realityVerdict = "unknown";
    detail =
      "no successful row read within budget (observer unavailable / malformed / unauthorized) — reality unresolved";
  }

  const witnessDelta =
    finalRow !== null && finalRow.note !== binding.expectedWitnessValue;

  return {
    observerClass: "observer_anon",
    observationScope: binding.observedFields,
    reads,
    converged,
    finalRow,
    realityVerdict,
    collateral: {
      witnessDelta,
      detail: witnessDelta
        ? "witness field differs from the bound expectation — in-scope collateral mutation"
        : "witness field intact",
    },
    detail,
  };
}
