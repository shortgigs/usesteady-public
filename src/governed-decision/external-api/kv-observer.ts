/**
 * Observer half of the KV certification adapter.
 *
 * The observer holds the READ-ONLY credential (observer_kv_read — a
 * Cloudflare API token with Workers KV Storage Read only; the API refuses
 * its writes). It reads the complete value envelope at the bound key under a
 * bounded convergence policy:
 *
 *   - finite read count (maxReads)
 *   - finite convergence deadline (deadlineMs)
 *   - deterministic linear backoff, every attempt timestamped
 *   - no unbounded polling, no background watcher
 *
 * Readback semantics (the exact rule — eventual-consistency adaptation):
 *
 *   AGREE     — observed envelope carries the expected target value AND the
 *               expected next revision AND the witness field is intact.
 *   DISAGREE  — the observed envelope AFFIRMATIVELY differs: a state that
 *               CANNOT be explained by edge-cache staleness — a wrong value,
 *               an unexpected higher revision, a mutated witness, or the
 *               bound post value+revision with a mutated witness (in-scope
 *               collateral).
 *   UNKNOWN   — a STALE-EXPLAINABLE state is still observed when the
 *               convergence deadline is exhausted: the bound prior state, an
 *               older prior-value revision, or key-absence (HTTP 404). On KV
 *               such a read may mean: not yet propagated / negative-or-stale
 *               edge cache / never applied / a later overwrite not yet
 *               visible. Non-convergence is NEVER contradiction. Also unknown
 *               when no successful envelope read was ever obtained
 *               (unavailable / malformed / unauthorized / rate-limited).
 *
 * ── Why "stale-explainable" is the decisive line on KV ───────────────────────
 *
 *   KV edge PoPs cache values (and misses) independently. A read can
 *   therefore return a value OLDER than a state the same observer already
 *   saw. A read is affirmative evidence only when no cache could hold it
 *   unless someone actually wrote it: the bound post-state (a future state),
 *   any revision higher than the bound prior, any value other than the bound
 *   prior/post, or a mutated witness. States at-or-before the bound prior
 *   carrying the prior value and the intact witness are exactly the states
 *   the harness itself wrote earlier — a stale cache can serve them — so
 *   they are INCONCLUSIVE, never contradiction. This is the governing
 *   invariant applied to an eventually-consistent substrate: preserve
 *   UNKNOWN rather than invent success OR contradiction.
 *
 *   429 during observation is a transport pacing event inside the bounded
 *   retry policy — recorded, retried, never a reality verdict. 404 during
 *   converge is inconclusive — negative-lookup caching is documented on KV,
 *   so absence is not "write failed".
 *
 * The convergence deadline is a READ BUDGET, not an affirmative failure
 * condition. Exhausting it while only stale-explainable states are visible
 * yields UNKNOWN — uncertainty is preserved as uncertainty and never
 * silently upgraded into contradiction.
 */

import { kvReadValue, KvTransportError, type FetchLike } from "./kv.js";
import type { ObserverMode } from "./observer.js";
import type {
  KvCredential,
  KvObservation,
  KvReadAttempt,
  KvValueEnvelope,
  KvWriteBinding,
} from "./kv-types.js";

export type KvReadPolicy = {
  /** Maximum number of read attempts (finite). */
  readonly maxReads: number;
  /** Convergence deadline in milliseconds from the first read (finite). */
  readonly deadlineMs: number;
  /** Base delay; attempt i (1-based) waits baseDelayMs * (i - 1) before reading. */
  readonly baseDelayMs: number;
};

/**
 * MEASUREMENT-DERIVED (M3, 2026-08-07, live run against the scratch
 * namespace from the operator vantage): 5/5 writes were visible to the
 * observer's REST GET on the FIRST read — msToConverge 43/46/45/32/33ms
 * (max 46ms, p50 43ms), zero 429s, zero absent reads; M1 independently
 * observed first-read convergence (56ms) and an immediate post-write GET
 * after a 404 returning 200 (no negative-cache staleness observed).
 *
 * Derivation (recorded by the M3 harness): baseDelayMs = 500 (poll
 * granularity floor); deadlineMs = max(5000, 3 × observed max) = 5000 —
 * ~100× the observed maximum; maxReads = ceil(deadline / interval) + 2 = 12.
 *
 * Honesty note: KV's documented global propagation can take far longer than
 * this vantage measured. A tighter-than-reality deadline can NEVER produce
 * a false verdict here — deadline exhaustion yields `unknown` (never
 * `disagree`), so a slower-propagation vantage degrades to honest
 * uncertainty, not contradiction. These values are therefore a bounded
 * measurement-derived policy, not parameters chosen to obtain PASS.
 */
export const DEFAULT_KV_READ_POLICY: KvReadPolicy = {
  maxReads: 12,
  deadlineMs: 5000,
  baseDelayMs: 500,
};

/** The envelope field set — the complete declared observation scope. */
export const KV_OBSERVATION_SCOPE: readonly string[] = ["field", "revision", "note"];

type EnvelopeClassification =
  /** Bound post-state, witness intact. */
  | "post_agree"
  /** Bound post value+revision, but the witness field mutated — collateral. */
  | "post_collateral"
  /** Exactly the bound prior state (value, revision, witness). */
  | "prior_exact"
  /**
   * Prior value at an OLDER revision, witness intact — stale-explainable
   * (the harness wrote this exact state earlier; an edge cache can serve
   * it). Inconclusive in BOTH modes, never contradiction.
   */
  | "prior_stale_older"
  /**
   * Affirmatively different from every stale-explainable state: wrong value,
   * unexpected higher revision, or a mutated witness. No cache can hold
   * such a state unless someone actually wrote it.
   */
  | "other";

function isWellFormedEnvelope(value: unknown): value is KvValueEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return (
    typeof envelope.field === "string" &&
    typeof envelope.revision === "number" &&
    typeof envelope.note === "string"
  );
}

function classifyEnvelope(
  binding: KvWriteBinding,
  envelope: KvValueEnvelope,
): EnvelopeClassification {
  if (
    envelope.field === binding.expectedTargetValue &&
    envelope.revision === binding.expectedNextRevision
  ) {
    return envelope.note === binding.expectedWitnessValue ? "post_agree" : "post_collateral";
  }
  if (
    envelope.field === binding.expectedPriorValue &&
    envelope.revision === binding.expectedPriorRevision &&
    envelope.note === binding.expectedWitnessValue
  ) {
    return "prior_exact";
  }
  if (
    envelope.field === binding.expectedPriorValue &&
    envelope.revision < binding.expectedPriorRevision &&
    envelope.note === binding.expectedWitnessValue
  ) {
    return "prior_stale_older";
  }
  return "other";
}

export async function observeKvScratchValue(
  binding: KvWriteBinding,
  cred: KvCredential,
  fetchImpl: FetchLike,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
  policy: KvReadPolicy = DEFAULT_KV_READ_POLICY,
  mode: ObserverMode = "converge",
): Promise<KvObservation> {
  if (cred.class !== "observer_kv_read") {
    throw new Error(
      `observer credential required (got ${cred.class}) — authority separation is structural`,
    );
  }

  const reads: KvReadAttempt[] = [];
  const startedAt = now().getTime();
  let finalEnvelope: KvValueEnvelope | null = null;
  let terminal: EnvelopeClassification | null = null;
  let terminatedByUnauthorized = false;
  let sawAbsent = false;

  for (let attempt = 1; attempt <= policy.maxReads; attempt++) {
    if (attempt > 1) {
      await sleep(policy.baseDelayMs * (attempt - 1));
    }
    const at = now().toISOString();
    let attemptRecord: KvReadAttempt;
    try {
      const res = await kvReadValue(cred, binding.namespaceId, binding.key, fetchImpl);
      if (res.status === 401 || res.status === 403) {
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "unauthorized",
          detail: "observer credential rejected — reality cannot be established",
        };
        terminatedByUnauthorized = true;
      } else if (res.status === 429) {
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "rate_limited",
          detail:
            "HTTP 429 — transport pacing event inside the bounded retry policy; not a reality verdict",
        };
      } else if (res.status === 404) {
        sawAbsent = true;
        attemptRecord = {
          attempt,
          at,
          httpStatus: res.status,
          outcome: "absent",
          detail:
            "key absent — inconclusive on KV (negative-lookup caching is documented: absence is not 'write failed')",
        };
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
      } else {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(res.bodyText);
        } catch {
          parsed = null;
        }
        if (!isWellFormedEnvelope(parsed)) {
          attemptRecord = {
            attempt,
            at,
            httpStatus: res.status,
            outcome: "malformed",
            detail: "response did not carry a well-formed value envelope",
          };
        } else {
          const envelope: KvValueEnvelope = {
            field: parsed.field,
            revision: parsed.revision,
            note: parsed.note,
          };
          finalEnvelope = envelope;
          attemptRecord = {
            attempt,
            at,
            httpStatus: res.status,
            outcome: "value",
            envelope,
            detail: "observed the bound key's envelope",
          };
          const classification = classifyEnvelope(binding, envelope);
          const isTerminal =
            classification === "post_agree" ||
            classification === "post_collateral" ||
            classification === "other" ||
            (mode === "snapshot" && classification === "prior_exact");
          if (isTerminal) terminal = classification;
        }
      }
    } catch (err) {
      if (!(err instanceof KvTransportError)) throw err;
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
  let realityVerdict: KvObservation["realityVerdict"];
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
    detail =
      "observed state affirmatively differs from every stale-explainable state (wrong value, unexpected higher revision, or mutated witness — no cache can hold it unless someone wrote it)";
  } else if (terminal === "prior_exact") {
    // Snapshot mode only: the current state is conclusively the bound prior —
    // relative to the approved post-state, a disagreement.
    realityVerdict = "disagree";
    detail = "observed the bound prior state — the approved post-state does not hold";
  } else if (finalEnvelope !== null) {
    realityVerdict = "unknown";
    detail =
      "convergence deadline exhausted while only a stale-explainable state (bound prior or an older prior-value revision) was visible — non-convergence preserved as uncertainty, never upgraded to a verdict";
  } else if (sawAbsent) {
    realityVerdict = "unknown";
    detail =
      "only key-absent reads within budget — inconclusive on KV (negative-lookup caching is documented: absence is not 'write failed'); reality unresolved";
  } else {
    realityVerdict = "unknown";
    detail =
      "no successful envelope read within budget (observer unavailable / malformed / unauthorized / rate-limited) — reality unresolved";
  }

  const witnessDelta =
    finalEnvelope !== null && finalEnvelope.note !== binding.expectedWitnessValue;

  return {
    observerClass: "observer_kv_read",
    observationScope: KV_OBSERVATION_SCOPE,
    reads,
    converged,
    finalEnvelope,
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
