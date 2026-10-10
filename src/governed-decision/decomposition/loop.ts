/**
 * Decomposed governed loop driver — D1 (Decomposition Machinery).
 *
 * Runs each candidate work item from a {@link DecompositionProposal} through
 * the FULL governed spine: draft → per-item ratification (persona seat via S1)
 * → final with the sandboxed executor + INDEPENDENT reality probe. Headless by
 * design — this is build-lane machinery exercised in sandboxes, not a
 * user-facing production feature.
 *
 * ── Invariants (D1, continued) ────────────────────────────────────────────────
 *
 *   INV-D1-3  Each item is ratified INDIVIDUALLY: one store thread per item,
 *             one draft, one ratification, one final. There is no batch
 *             approval path — a verdict never spans two items.
 *
 *   INV-D1-5  Persona seats obey the S1 gates verbatim: the driver constructs
 *             ratifications ONLY through `makePersonaRatification` (so
 *             approverKind: "persona" is structural, INV-SO-2) and refuses to
 *             run at all unless `GOVERNED_SYNTHETIC_RATIFIER=1` is present in
 *             the environment it was handed (INV-SO-3 — fail-closed; the
 *             driver cannot be smuggled onto an ungated surface).
 *
 *   INV-D1-6  Every item's records declare the source conversation as an
 *             `asserted_artifact` reference (`conversation:sha256:<hash>`), so
 *             lineage links all N items to the same source at the honest
 *             `unverified` band.
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   The driver decides NOTHING. The per-item verdict comes from an injectable
 *   `verdict` function (the persona's judgment, supplied by the build lane).
 *   The DEFAULT verdict is deterministic and fail-closed: approve only when
 *   the draft's Decision Basis policy clearance is "cleared"; anything else —
 *   conflict detected, basis unavailable, malformed section — rejects. It
 *   never invents facts and never overrides the spine's own gates: execution
 *   still only actuates when the spine confirms an approved, fingerprint-
 *   anchored ratification.
 */

import {
  produceDraft,
  produceFinal,
  ratifiableFingerprint,
  makeSandboxedFsExecutor,
  makeFsRealityProbe,
} from "../runner.js";
import type { GovernedDecisionStore, StoredRecord } from "../store.js";
import type {
  GovernedDecisionRecord,
  RatificationDecision,
  Reference,
} from "../types.js";
import type { CursorOCDPolicy } from "../../cursor/types.js";
import {
  makePersonaRatification,
  syntheticRatifierEnabled,
} from "../ratifier/persona.js";
import type { CandidateWorkItem, DecompositionProposal } from "./decompose.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The persona's per-item judgment — injectable; supplied by the build lane. */
export type ItemVerdict = (
  draft: GovernedDecisionRecord,
  item: CandidateWorkItem,
) => RatificationDecision;

export type DecomposedItemResult = {
  readonly item: CandidateWorkItem;
  readonly draft: StoredRecord;
  /** Null when the draft produced no ratifiable fingerprint (nothing to ratify). */
  readonly final: StoredRecord | null;
  /** The persona's verdict, or null when no ratification was possible. */
  readonly decision: RatificationDecision | null;
};

export type DecomposedLoopResult =
  | { readonly ok: true; readonly results: readonly DecomposedItemResult[] }
  | { readonly ok: false; readonly reason: string };

export type DecomposedLoopOptions = {
  readonly store: GovernedDecisionStore;
  /** Persona identity for every item's seat, e.g. "skeptic-1" (no prefix). */
  readonly personaId: string;
  /** Sandbox root: executor containment, reality probe, and basis sensing. */
  readonly workspace: string;
  /** OCD policy for the basis policy sensor; omitted → policy unavailable. */
  readonly policy?: CursorOCDPolicy | null;
  /** Per-item verdict; defaults to {@link policyClearanceVerdict}. */
  readonly verdict?: ItemVerdict;
  /** Environment to check the INV-SO-3 gate against; defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
};

// ─── Default verdict (deterministic, fail-closed) ─────────────────────────────

/**
 * Approve ONLY when the draft's Decision Basis policy clearance is "cleared".
 * Conflict detected, basis/policy unavailable, no clearance (no proposal), or
 * any malformed shape → rejected. Defensive reads throughout — this function
 * must never throw on any record shape (mirrors the projection contract).
 */
export function policyClearanceVerdict(
  draft: GovernedDecisionRecord,
): RatificationDecision {
  const basis = draft.decisionBasis as
    | { status?: unknown; value?: { policy?: unknown } }
    | undefined;
  if (basis === undefined || basis === null || basis.status !== "connected") {
    return "rejected";
  }
  const policy = basis.value?.policy as
    | { status?: unknown; value?: { clearance?: { status?: unknown } } }
    | undefined;
  if (policy === undefined || policy === null || policy.status !== "connected") {
    return "rejected";
  }
  return policy.value?.clearance?.status === "cleared" ? "approved" : "rejected";
}

// ─── Driver ───────────────────────────────────────────────────────────────────

/**
 * Run every item of a decomposition through the governed spine. Sequential by
 * design: items may target overlapping paths, and the evidence each ratifier
 * reviews must describe the workspace as the PREVIOUS item left it.
 */
export async function runDecomposedLoop(
  proposal: DecompositionProposal,
  options: DecomposedLoopOptions,
): Promise<DecomposedLoopResult> {
  // INV-D1-5 / INV-SO-3: the driver itself fails closed on an ungated surface.
  const env = options.env ?? process.env;
  if (!syntheticRatifierEnabled(env)) {
    return {
      ok: false,
      reason:
        "synthetic ratifier not enabled on this surface (GOVERNED_SYNTHETIC_RATIFIER=1 required; INV-SO-3 fails closed)",
    };
  }

  const verdict = options.verdict ?? ((draft) => policyClearanceVerdict(draft));
  const references: readonly Reference[] = [
    {
      kind: "asserted_artifact",
      ref: `conversation:sha256:${proposal.conversationSha256}`,
    },
  ];

  const results: DecomposedItemResult[] = [];

  for (const item of proposal.items) {
    const intent = { goal: item.goal, constraints: [] as readonly string[] };

    // Draft: full spine run, ratification honestly unavailable.
    const draftRecord = await produceDraft(
      intent,
      { references },
      {
        basisWorkspace: options.workspace,
        basisPolicy: options.policy ?? null,
      },
    );
    const storedDraft = options.store.appendDraft(draftRecord);

    const fingerprint = ratifiableFingerprint(draftRecord);
    if (fingerprint === null) {
      // Nothing stamped to ratify — record the honest gap and move on. No
      // final is fabricated for an unratifiable draft.
      results.push({ item, draft: storedDraft, final: null, decision: null });
      continue;
    }

    // Persona judgment (INV-D1-3: one verdict per item, never spanning items).
    const decision = verdict(draftRecord, item);

    // S1 seat: the ONLY construction path for a persona ratification.
    const ratification = makePersonaRatification({
      personaId: options.personaId,
      decision,
      ratifiedFingerprint: fingerprint,
    });

    // Final: executor + INDEPENDENT probe are always offered; the spine's
    // fail-closed gate ensures they only actuate/verify on an approved,
    // fingerprint-anchored ratification.
    const finalRecord = await produceFinal(intent, ratification, {
      executor: makeSandboxedFsExecutor(options.workspace),
      realityProbe: makeFsRealityProbe(options.workspace),
      references,
      basisWorkspace: options.workspace,
      basisPolicy: options.policy ?? null,
    });
    const storedFinal = options.store.appendFinal(
      finalRecord,
      storedDraft.envelope.threadId,
      storedDraft.record.recordId,
    );

    results.push({ item, draft: storedDraft, final: storedFinal, decision });
  }

  return { ok: true, results };
}
