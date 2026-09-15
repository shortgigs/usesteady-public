/**
 * Governed Decision CLI — the projection-only command surface over the kernel.
 *
 * Canonical design: docs/architecture/USESTEADY_GOVERNED_DECISION_SURFACE_V1.md
 * (Phase E2).
 *
 * Three commands, consuming ONLY runner + store + projection + epistemic:
 *
 *   decide "<goal>" [--constraint "<c>"]... [--approve|--reject] [--approver "<n>"]
 *       Produce + store an immutable DRAFT, project it, and (if a decision flag is
 *       given) capture the human's Approve/Reject as the ONE authorized write:
 *       produceFinal anchored to the draft's fingerprint, store the FINAL, project.
 *   decisions
 *       List stored decision threads (draft + latest final, ratified decision).
 *   show <recordId>
 *       Project a single stored record (+ its epistemic objects).
 *
 * ── Authority boundary (must not drift) ───────────────────────────────────────
 *
 *   This surface PROJECTS and CAPTURES one decision. It never sets a section
 *   status, never assembles a decision, never computes a fingerprint (it reads the
 *   draft's via ratifiableFingerprint), and never decides whether execution runs.
 *   The human's Approve/Reject is passed verbatim to the runner. It imports only
 *   runner, store, projection and epistemic — no stage internals.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyEpistemic, type EpistemicObject } from "./epistemic.js";
import { evaluateElicitation } from "./elicitation.js";
import { buildInvocationLineage, renderLineageLines } from "./lineage.js";
import {
  buildDecideProjection,
  elicitationQuestions,
  emitJsonLine,
  errorResponse,
  isInteractiveTTY,
  lineageToJsonData,
  localCertification,
  nowIso,
  refsToJson,
  type CliCommand,
  type CliJsonEnvelope,
} from "./output.js";
import { projectGovernedDecision, renderProjectionLines } from "./projection.js";
import {
  produceDraft,
  produceFinal,
  ratifiableFingerprint,
  makeSandboxedFsExecutor,
  makeFsRealityProbe,
  candidatePlanFromRecord,
  senseReplacePin,
  replacePinFromRecord,
  senseDeletePin,
  deletePinFromRecord,
  senseRenamePin,
  renamePinFromRecord,
  type HumanRatification,
  type DeterministicExecutor,
  type RealityProbe,
  type ScopeSensor,
  makeFsScopeSensor,
  type LoopInput,
  type CandidatePlanInput,
  makeBoundaryJsonlSink,
  type BoundarySink,
} from "./runner.js";
import { createGovernedDecisionStore } from "./store.js";
import { PERSONA_APPROVER_PREFIX } from "./types.js";
// The ratifier provider is a peer seam module (same read-side tier as
// runner/store) — NOT a stage internal. The cli boundary test allows it.
import { makePersonaRatification, syntheticRatifierEnabled } from "./ratifier/persona.js";
import { DEFAULT_CURSOR_POLICY } from "../shell/defaults.js";
import type {
  GovernedDecisionRecord,
  HumanIntent,
  ObservationPayload,
  Reference,
  ReferenceKind,
} from "./types.js";

// ─── Injectable I/O (tests pass capture buffers + a temp store dir) ───────────

export type CliIO = {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Store directory override; defaults to ~/.usesteady/governed-decisions. */
  storeDir?: string;
  /**
   * Override TTY detection for authority checks (tests only). Production bin
   * paths leave this unset and use process stdin/stdout isTTY.
   */
  interactive?: boolean;
};

// ─── Rendering helpers ────────────────────────────────────────────────────────

const EPISTEMIC_LABEL: Readonly<Record<EpistemicObject["kind"], string>> = {
  inference: "Inference ",
  hypothesis: "Hypothesis",
  prediction: "Prediction",
  outcome: "Outcome   ",
};

function renderEpistemicLines(record: GovernedDecisionRecord): readonly string[] {
  const lines: string[] = ["Epistemic objects:"];
  for (const obj of classifyEpistemic(record)) {
    const label = EPISTEMIC_LABEL[obj.kind];
    const statement = obj.statement !== undefined ? `  ${obj.statement}` : "";
    lines.push(`  ${label}  [${obj.status}]${statement}`);
  }
  return lines;
}

function printRecord(io: CliIO, heading: string, record: GovernedDecisionRecord): void {
  io.out(`== ${heading} ==`);
  for (const line of renderProjectionLines(projectGovernedDecision(record))) {
    io.out(line);
  }
  for (const line of renderEpistemicLines(record)) {
    io.out(line);
  }
}

/**
 * Human-readable summary of what the executor actuated, read verbatim from the
 * final record's execution section. Used to LOUDLY surface an actuation whose
 * audit record failed to persist, so an approved real-world action is never
 * silently unrecorded.
 */
function summarizeActuation(record: GovernedDecisionRecord): string {
  const ex = record.execution;
  if (ex.status !== "connected" || ex.value.results === undefined) {
    return "no filesystem actuation occurred";
  }
  return ex.value.results
    .map((r) => `${r.status}: ${r.op.kind} ${r.op.path} (${r.detail})`)
    .join("; ");
}

/**
 * Append a produced FINAL record, surfacing a persistence failure loudly.
 *
 * Actuation (when an executor is opted in) necessarily happens INSIDE
 * `produceFinal` — the execution result is part of the record being persisted, so
 * the action cannot be recorded before it occurs. If `appendFinal` then throws
 * (disk full, permissions), the approved ops have already actuated; we emit the
 * actuation outcome to stderr so it is never silently lost. The sandboxed
 * executor is idempotent over its non-destructive allowlist, so an operator retry
 * after this failure cannot cause additional real-world effect. This is a narrow
 * durability edge consistent with the append-only store model (the persistent DB
 * backend is the proper substrate for transactional durability).
 *
 * Returns the stored final on success, or null on persistence failure (caller
 * returns a non-zero exit).
 */
function appendFinalLoud(
  io: CliIO,
  store: ReturnType<typeof createGovernedDecisionStore>,
  final: GovernedDecisionRecord,
  threadId: string,
  draftRecordId: string,
): ReturnType<ReturnType<typeof createGovernedDecisionStore>["appendFinal"]> | null {
  try {
    return store.appendFinal(final, threadId, draftRecordId);
  } catch (persistErr) {
    const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
    io.err(`CRITICAL: decision finalized but the audit record failed to persist: ${message}`);
    io.err(`actuation outcome (UNRECORDED): ${summarizeActuation(final)}`);
    return null;
  }
}

/**
 * After an APPROVED final, surface a concrete next step when execution was NOT
 * opted in and the kernel therefore actuated nothing. The kernel's own reason is
 * surface-agnostic ("execution is opt-in — no executor was provided"); the CLI is
 * the right layer to name its own opt-in mechanism (--execute --workspace), so the
 * operator who just approved a decision is never left without a path to actuation.
 *
 * Accuracy note (single-ratification): execution is wired only inside
 * `produceFinal`, which runs at ratification time, and a thread is ratified
 * exactly once. So THIS decision cannot gain execution retroactively — neither a
 * second `ratify` of the same draft (it is already ratified) nor any edit to the
 * stored final. The honest path to actuation is therefore a FRESH decision
 * approved with execution enabled, not "re-run this one". The hint says exactly
 * that for both the `decide --approve` and `ratify --approve` paths.
 *
 * Printed ONLY when: the human approved, --execute was not passed, and the final's
 * execution section is `unavailable` precisely because no executor was wired. It is
 * a hint, never an action — it changes no default and asserts no authority.
 */
function maybePrintOptInHint(
  io: CliIO,
  flags: ParsedFlags,
  final: GovernedDecisionRecord,
): void {
  if (!flags.approve || flags.execute) return;
  const ex = final.execution;
  if (ex.status !== "unavailable") return;
  if (!ex.reason.includes("execution is opt-in")) return;
  io.out(
    "Execution is opt-in and is chosen at approval time: this decision was\n" +
      "  approved without it, so nothing was actuated — and it cannot be actuated\n" +
      "  later (a decision is ratified once). To actuate, make a FRESH decision\n" +
      "  approved with execution enabled:\n" +
      '    usesteady decide "<goal>" --approve --execute --workspace <root>\n' +
      "  (the executor is confined to <root>; observation then independently\n" +
      "   verifies the result on disk — reality's final veto).",
  );
}

// ─── Candidate plan seam (AI_SEAMS_V1 seam 2 — L2.S3) ─────────────────────────

/** Display shape mirrored from the proposer (type-only coupling; no SDK load). */
type ProposedPlanStep = { readonly phrase: string; readonly summary: string };

/**
 * Consult the bounded plan proposer ONCE for a goal the deterministic parser
 * could not classify. Dynamically imported so the Anthropic SDK is never loaded
 * on deterministic paths; env is hydrated from ~/.usesteady/config.json first
 * (env always wins). Every failure returns null — fail-closed to today's
 * behavior (INV-AI-3).
 */
async function consultCandidatePlan(
  goal: string,
): Promise<readonly ProposedPlanStep[] | null> {
  try {
    const [{ proposeCandidatePlan }, { hydrateEnvFromConfig }] = await Promise.all([
      import("../intake/candidate-plan.js"),
      import("../shell/cli/config-hydration.js"),
    ]);
    hydrateEnvFromConfig();
    const proposal = await proposeCandidatePlan(goal);
    return proposal === null ? null : proposal.steps;
  } catch {
    return null;
  }
}

/**
 * Present the candidate plan as SYSTEM SUGGESTS-class content: explicitly
 * candidates, never SYSTEM WILL, never truth until the human ratifies the
 * stamped draft that carries it (INV-AI-2).
 */
function printCandidatePlanNotice(io: CliIO, steps: readonly ProposedPlanStep[]): void {
  io.out("SYSTEM SUGGESTS — candidate plan (model-proposed, not truth yet):");
  steps.forEach((step, i) => {
    io.out(`  ${i + 1}. ${step.summary}  [${step.phrase}]`);
  });
  io.out(
    "Each step re-parsed deterministically; nothing runs until you ratify the draft below.",
  );
}

// ─── Tiny argv parsing (no dependency) ────────────────────────────────────────

type ParsedFlags = {
  readonly positionals: readonly string[];
  readonly constraints: readonly string[];
  readonly approve: boolean;
  readonly reject: boolean;
  readonly approver: string;
  /** Opt-in: actuate the approved ops with the sandboxed FS executor. */
  readonly execute: boolean;
  /** Required with --execute: the sandbox root the executor is confined to. */
  readonly workspace: string | null;
  /**
   * Automatic loop: feed a prior stored decision's observation into THIS cycle's
   * Decision Basis as lowest-authority evidence. The value is the prior decision's
   * recordId. The spine gates eligibility (only feedsNextCycle observations feed).
   */
  readonly from: string | null;
  /**
   * Explicit Invocation Lineage: declared reference inputs this invocation depends
   * on (repeatable). Raw `kind:ref` specs; parsed by {@link parseReferenceSpecs}.
   * Recorded as lineage edges with a kind-derived authority band — the caller
   * cannot self-certify authority (INV-EIL-5).
   */
  readonly refs: readonly string[];
  /** Machine-readable JSON envelope on stdout (draft-only for decide; no auto-ratify). */
  readonly json: boolean;
  /**
   * Ratifier seat selection (S1 — SYNTHETIC_OPERATOR_LANE_V1). `null` = the
   * human seat (default; TTY-gated). `persona:<id>` selects the synthetic seat,
   * permitted ONLY when GOVERNED_SYNTHETIC_RATIFIER=1 is set in the process
   * environment (INV-SO-3; build lanes only). The swap is configuration — both
   * seats flow through the identical kernel path.
   */
  readonly ratifier: string | null;
};

const REFERENCE_KINDS: ReadonlySet<string> = new Set<ReferenceKind>([
  "prior_observation",
  "certified_decision",
  "verified_artifact",
  "asserted_artifact",
]);

/**
 * Parse a single `--ref` spec into a declared {@link Reference}.
 *
 * Form `kind:ref` when the prefix is a known ReferenceKind (e.g.
 * `asserted_artifact:external://spec.md`); otherwise the whole value is the ref
 * and the kind defaults to `certified_decision` (the prior-decision case, e.g.
 * `--ref <recordId>`). The caller declares the dependency; it never self-certifies
 * authority — the kind maps to an authority band downstream.
 */
function parseReferenceSpec(spec: string): Reference | { error: string } {
  const idx = spec.indexOf(":");
  if (idx > 0) {
    const prefix = spec.slice(0, idx);
    if (REFERENCE_KINDS.has(prefix)) {
      const ref = spec.slice(idx + 1).trim();
      if (ref.length === 0) return { error: `--ref "${spec}": empty reference target after "${prefix}:"` };
      return { kind: prefix as ReferenceKind, ref };
    }
  }
  const ref = spec.trim();
  if (ref.length === 0) return { error: "--ref: empty reference" };
  return { kind: "certified_decision", ref };
}

/** Parse all `--ref` specs; returns the declared references or the first error. */
function parseReferenceSpecs(
  specs: readonly string[],
): { references: readonly Reference[] } | { error: string } {
  const references: Reference[] = [];
  for (const spec of specs) {
    const parsed = parseReferenceSpec(spec);
    if ("error" in parsed) return { error: parsed.error };
    references.push(parsed);
  }
  return { references };
}

/** Reconstruct declared Reference inputs from a stored record's lineage edges. */
function referencesFromRecord(record: GovernedDecisionRecord): readonly Reference[] {
  const raw = (record as { references?: unknown }).references;
  if (!Array.isArray(raw)) return [];
  const out: Reference[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== "object") continue;
    const kind = (e as { kind?: unknown }).kind;
    const ref = (e as { ref?: unknown }).ref;
    if (typeof kind === "string" && REFERENCE_KINDS.has(kind) && typeof ref === "string" && ref.length > 0) {
      out.push({ kind: kind as ReferenceKind, ref });
    }
  }
  return out;
}

function parseFlags(args: readonly string[]): ParsedFlags {
  const positionals: string[] = [];
  const constraints: string[] = [];
  let approve = false;
  let reject = false;
  let approver = "cli";
  let execute = false;
  let workspace: string | null = null;
  let from: string | null = null;
  const refs: string[] = [];
  let json = false;
  let ratifier: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--ref") {
      const next = args[i + 1];
      if (next !== undefined) {
        refs.push(next);
        i += 1;
      }
    } else if (arg === "--approve") {
      approve = true;
    } else if (arg === "--reject") {
      reject = true;
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--constraint") {
      const next = args[i + 1];
      if (next !== undefined) {
        constraints.push(next);
        i += 1;
      }
    } else if (arg === "--approver") {
      const next = args[i + 1];
      if (next !== undefined) {
        approver = next;
        i += 1;
      }
    } else if (arg === "--workspace") {
      const next = args[i + 1];
      if (next !== undefined) {
        workspace = next;
        i += 1;
      }
    } else if (arg === "--from") {
      const next = args[i + 1];
      if (next !== undefined) {
        from = next;
        i += 1;
      }
    } else if (arg === "--ratifier") {
      const next = args[i + 1];
      if (next !== undefined) {
        ratifier = next;
        i += 1;
      }
    } else if (arg !== undefined) {
      positionals.push(arg);
    }
  }

  return { positionals, constraints, approve, reject, approver, execute, workspace, from, refs, json, ratifier };
}

/**
 * Build the opt-in sandboxed executor AND its paired INDEPENDENT reality probe
 * from --execute/--workspace, or nulls when execution was not requested. Returns
 * an error string when --execute was given without a --workspace (execution must
 * be explicitly bounded to a sandbox root).
 *
 * The probe is bound to the SAME workspace the executor actuated, so observation
 * independently verifies on disk exactly what was just written — reality's veto.
 */
function resolveExecutor(
  flags: ParsedFlags,
):
  | {
      executor: DeterministicExecutor | null;
      realityProbe: RealityProbe | null;
      scopeSensor: ScopeSensor | null;
    }
  | { error: string } {
  if (!flags.execute) return { executor: null, realityProbe: null, scopeSensor: null };
  if (flags.workspace === null || flags.workspace.trim().length === 0) {
    return { error: "--execute requires --workspace <root> (the sandbox the executor is confined to)" };
  }
  return {
    executor: makeSandboxedFsExecutor(flags.workspace),
    realityProbe: makeFsRealityProbe(flags.workspace),
    // Collateral Mutation Closure V1: the observer-side scope sensor, bound to
    // the SAME workspace. The execution stage captures the declared scope +
    // pre-actuation snapshot BEFORE the executor runs; the probe reconciles.
    scopeSensor: makeFsScopeSensor(flags.workspace),
  };
}

/**
 * Process-local receiving-boundary sink. Path is derived from the CLI store
 * directory (operator/test I/O), never from request/flag-selected sink input.
 */
function resolveBoundarySink(io: CliIO): BoundarySink {
  const dir = io.storeDir ?? join(homedir(), ".usesteady", "governed-decisions");
  return makeBoundaryJsonlSink(join(dir, "boundary-observations.jsonl"));
}

/**
 * Resolve the automatic-loop input from a prior stored decision (--from <ref>).
 *
 * Reads the prior record's OBSERVATION section verbatim and offers it as loop
 * input. It does NOT decide eligibility — the spine's `eligiblePrior` gate does
 * (only `feedsNextCycle === true` observations actually feed basis). When the
 * prior decision has no observation to feed (e.g. it was never executed), the
 * observation is offered as `null` with a human-readable `note`, and the spine
 * naturally records `priorObservationRef: null`.
 *
 * Returns `{ error }` only when the referenced record does not exist — feeding
 * from a non-existent decision is an operator mistake, not an honest absence.
 */
function resolvePriorObservation(
  store: ReturnType<typeof createGovernedDecisionStore>,
  recordId: string,
):
  | { priorObservation: ObservationPayload | null; priorObservationRef: string; note: string | null }
  | { error: string } {
  const stored = store.getRecord(recordId);
  if (stored === null) {
    return { error: `no stored record with recordId ${recordId} to feed from (--from)` };
  }
  const obs = stored.record.observation;
  if (obs.status === "unavailable") {
    return {
      priorObservation: null,
      priorObservationRef: recordId,
      note: `prior decision ${recordId} has no observation to feed (${obs.reason})`,
    };
  }
  // value-bearing (derived/connected): offer the real observation payload.
  return { priorObservation: obs.value, priorObservationRef: recordId, note: null };
}

/**
 * Print the honest outcome of a --from loop attempt, read from the PRODUCED
 * record (the spine's gate is authoritative, not the surface). `priorObservationRef`
 * is non-null on the record IFF the prior observation was eligible and fed basis.
 */
function printLoopOutcome(
  io: CliIO,
  from: string | null,
  note: string | null,
  record: GovernedDecisionRecord,
): void {
  if (from === null) return;
  if (note !== null) {
    io.out(`Loop: ${note}; basis evidence remains isolated.`);
    return;
  }
  if (record.priorObservationRef !== null) {
    io.out(
      `Loop: prior observation ${from} fed THIS cycle's Decision Basis as evidence ` +
        "(an unarbitrated, lowest-authority claim — never authority or execution).",
    );
  } else {
    io.out(
      `Loop: prior observation ${from} was not eligible to feed ` +
        "(its feedsNextCycle is false); basis evidence remains isolated.",
    );
  }
}

const USAGE = [
  "usesteady governed — projection-only surface over the constitutional kernel",
  "",
  "Commands:",
  '  decide "<goal>" [--constraint "<c>"]... [--ref <kind:ref>]... [--approve|--reject] [--approver "<name>"] [--execute --workspace <root>] [--from <priorRecordId>]',
  '  ratify <draftRecordId> --approve|--reject [--approver "<name>"] [--execute --workspace <root>]',
  "  decisions",
  "  show <recordId>",
  "  lineage <recordId>",
  "",
  "  --execute  actuate the approved ops (create_dir/create_file/replace_in_file/delete_file/rename_file)",
  "             with the sandboxed FS executor. Requires --workspace <root>; the",
  "             executor is confined to that root and never overwrites files.",
  "             Observation then INDEPENDENTLY verifies the actuated ops on disk",
  "             (reality's final veto): realityVerdict becomes agree/disagree.",
  "  --from     feed a prior decision's observation into THIS decision's Decision",
  "             Basis as lowest-authority evidence (the automatic loop). Only an",
  "             observation whose feedsNextCycle is true is eligible; it informs",
  "             basis only, never authority or execution. ratify inherits the",
  "             prior reference from the reviewed draft (do not re-pass --from).",
  "  --ref      declare a reference input THIS invocation depends on (repeatable),",
  "             as <kind:ref> where kind is one of certified_decision,",
  "             verified_artifact, asserted_artifact, prior_observation. A bare",
  "             value (no kind:) defaults to certified_decision, e.g.",
  "             --ref <priorRecordId>. The dependency is DECLARED, not inherited",
  "             from an open conversation, and is re-arbitrated into the Decision",
  "             Basis -- the caller cannot self-certify its authority. Inspect the",
  "             resulting chain with: usesteady lineage <recordId>. ratify inherits",
  "             the draft's declared references (do not re-pass --ref).",
  "",
  "  --json     emit a schemaVersion 1.0 JSON envelope (decide is draft-only;",
  "             ratify requires --approve in an interactive TTY).",
  "  --ratifier persona:<id>  seat a SYNTHETIC ratifier (build lanes only).",
  "             Blocked unless GOVERNED_SYNTHETIC_RATIFIER=1 is set in the",
  "             process environment (INV-SO-3; never derivable from input).",
  "             The record carries approverKind: persona -- a persona",
  "             ratification is never stored or rendered as a human one.",
  "             Default (no flag) is the human seat, TTY-gated as before.",
].join("\n");

// ─── JSON envelope + authority (A2) ───────────────────────────────────────────

function jsonExitCode(payload: CliJsonEnvelope): number {
  if (payload.status !== "error") return 0;
  const code = payload.error?.code;
  if (code === "AUTHORITY_VIOLATION" || code === "USAGE") return 2;
  return 1;
}

function emitJson(io: CliIO, payload: CliJsonEnvelope): number {
  emitJsonLine(io.out, payload);
  return jsonExitCode(payload);
}

function isCliInteractive(io: CliIO): boolean {
  if (io.interactive !== undefined) return io.interactive;
  return isInteractiveTTY();
}

// ─── Ratifier seat resolution (S1 — SYNTHETIC_OPERATOR_LANE_V1) ────────────────

/**
 * Which seat is deciding on this invocation. The human seat is the default and
 * keeps its TTY authority proof; the persona seat is selected explicitly with
 * `--ratifier persona:<id>` and is controlled by the process-environment gate
 * (INV-SO-3) instead of the TTY — a synthetic seat has no terminal to prove.
 */
type RatifierSeat = { readonly kind: "human" } | { readonly kind: "persona"; readonly personaId: string };

/**
 * Resolve the ratifier seat from flags + environment. Fail-closed:
 *
 *   - `--approver persona:*` without `--ratifier` is refused (the namespace is
 *     reserved; a persona seat must be selected explicitly, never smuggled
 *     through the human approver flag).
 *   - `--ratifier` accepts only `persona:<id>` (the human seat is the default,
 *     not a selectable spec — there is nothing to configure about H).
 *   - a persona seat while GOVERNED_SYNTHETIC_RATIFIER is not "1" is an
 *     AUTHORITY_VIOLATION: production surfaces BLOCK persona seats (INV-SO-3).
 */
function resolveRatifierSeat(
  flags: ParsedFlags,
): RatifierSeat | { readonly error: string; readonly code: "USAGE" | "AUTHORITY_VIOLATION" } {
  if (flags.ratifier === null) {
    if (flags.approver.startsWith(PERSONA_APPROVER_PREFIX)) {
      return {
        error:
          "the 'persona:' approver namespace is reserved for the synthetic seat; select it explicitly with --ratifier persona:<id>",
        code: "USAGE",
      };
    }
    return { kind: "human" };
  }
  if (!flags.ratifier.startsWith(PERSONA_APPROVER_PREFIX)) {
    return {
      error: `--ratifier "${flags.ratifier}": only "persona:<id>" seats are selectable (the human seat is the default)`,
      code: "USAGE",
    };
  }
  const personaId = flags.ratifier.slice(PERSONA_APPROVER_PREFIX.length).trim();
  if (personaId.length === 0 || /[\s:]/.test(personaId)) {
    return {
      error: `--ratifier "${flags.ratifier}": persona id must be non-empty with no whitespace or ':'`,
      code: "USAGE",
    };
  }
  if (!syntheticRatifierEnabled()) {
    return {
      error:
        "persona ratifier is blocked on this surface (INV-SO-3): the synthetic seat requires GOVERNED_SYNTHETIC_RATIFIER=1 in the process environment (build lanes only)",
      code: "AUTHORITY_VIOLATION",
    };
  }
  return { kind: "persona", personaId };
}

function checkDecideAuthority(
  io: CliIO,
  flags: ParsedFlags,
  seat: RatifierSeat,
): CliJsonEnvelope | null {
  if (flags.json && (flags.approve || flags.reject)) {
    return errorResponse(
      "decide",
      "AUTHORITY_VIOLATION",
      "--approve/--reject is only allowed in interactive TTY without --json. Use JSON mode for draft-only, then `usesteady ratify <id> --approve` from a terminal.",
    );
  }
  // The TTY proof belongs to the HUMAN seat only. A persona seat has no
  // terminal to prove; its authority control is the environment gate already
  // enforced by resolveRatifierSeat (INV-SO-3) — headless build lanes drive it.
  if (seat.kind === "human" && !flags.json && (flags.approve || flags.reject) && !isCliInteractive(io)) {
    return errorResponse(
      "decide",
      "AUTHORITY_VIOLATION",
      "--approve/--reject requires an interactive TTY. Use `decide --json` for draft-only or run ratify from a terminal.",
    );
  }
  return null;
}

function checkRatifyAuthority(
  io: CliIO,
  flags: ParsedFlags,
  seat: RatifierSeat,
): CliJsonEnvelope | null {
  if (seat.kind === "human" && (flags.approve || flags.reject) && !isCliInteractive(io)) {
    return errorResponse(
      "ratify",
      "AUTHORITY_VIOLATION",
      "--approve/--reject requires an interactive TTY. Agents may propose with `decide --json` only.",
    );
  }
  return null;
}

function failOrErr(
  io: CliIO,
  flags: ParsedFlags,
  command: CliCommand,
  message: string,
  code: string,
  ttyExit: number,
): number {
  if (flags.json) {
    return emitJson(io, errorResponse(command, code, message));
  }
  io.err(message);
  return ttyExit;
}

function emitDecideJson(
  io: CliIO,
  opts: {
    status: "draft" | "needs_input" | "success";
    recordId: string;
    goal: string;
    record: GovernedDecisionRecord;
    references: readonly Reference[];
    message: string;
    nextSteps?: readonly string[];
  },
): number {
  const projection = projectGovernedDecision(opts.record);
  const elicitation = evaluateElicitation(opts.record);
  return emitJson(io, {
    schemaVersion: "1.0",
    command: "decide",
    status: opts.status,
    recordId: opts.recordId,
    timestamp: nowIso(),
    data: {
      goal: opts.goal,
      projection: buildDecideProjection(opts.record, projection),
      elicitation: elicitationQuestions(elicitation),
      refs: refsToJson(opts.references),
    },
    message: opts.message,
    ...(opts.nextSteps !== undefined ? { nextSteps: [...opts.nextSteps] } : {}),
    certification: localCertification(),
  });
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function cmdDecide(io: CliIO, args: readonly string[]): Promise<number> {
  // Portal Connect Tools smoke + docs use `usesteady decide --help`.
  // Without this, `--help` was treated as a goal and stored as a draft.
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    io.out(USAGE);
    return 0;
  }

  const flags = parseFlags(args);
  const goal = flags.positionals[0];
  if (goal === undefined || goal.trim().length === 0) {
    return failOrErr(
      io,
      flags,
      "decide",
      'decide requires a goal, e.g. usesteady decide "create a folder utils"',
      "USAGE",
      2,
    );
  }
  if (flags.approve && flags.reject) {
    return failOrErr(
      io,
      flags,
      "decide",
      "decide accepts at most one of --approve / --reject",
      "USAGE",
      2,
    );
  }

  const seat = resolveRatifierSeat(flags);
  if ("error" in seat) {
    return failOrErr(io, flags, "decide", seat.error, seat.code, 2);
  }

  const authErr = checkDecideAuthority(io, flags, seat);
  if (authErr !== null) {
    if (flags.json) return emitJson(io, authErr);
    io.err(authErr.error?.message ?? "authority violation");
    return 2;
  }

  const exec = resolveExecutor(flags);
  if ("error" in exec) {
    return failOrErr(io, flags, "decide", exec.error, "USAGE", 2);
  }

  // Explicit Invocation Lineage: parse declared references (--ref). These are the
  // caller's DECLARED dependency inputs (a clearer goal's prior decision, an
  // artifact, ...). The kind maps to an authority band downstream; the caller
  // cannot self-certify (INV-EIL-5). An unverified reference is re-arbitrated, not
  // inherited as truth.
  const refsParsed = parseReferenceSpecs(flags.refs);
  if ("error" in refsParsed) {
    return failOrErr(io, flags, "decide", refsParsed.error, "USAGE", 2);
  }
  const references = refsParsed.references;

  const intent: HumanIntent = { goal, constraints: flags.constraints };
  const store = createGovernedDecisionStore(io.storeDir);

  // 0. Resolve the automatic-loop input (--from), if any. The spine gates
  //    eligibility; we only source the prior observation and thread it. Declared
  //    references (--ref) are threaded alongside it on the same LoopInput.
  let loop: LoopInput = references.length > 0 ? { references } : {};
  let loopNote: string | null = null;
  if (flags.from !== null) {
    const r = resolvePriorObservation(store, flags.from);
    if ("error" in r) {
      return failOrErr(io, flags, "decide", r.error, "NOT_FOUND", 1);
    }
    loop = {
      priorObservation: r.priorObservation,
      priorObservationRef: r.priorObservationRef,
      ...(references.length > 0 ? { references } : {}),
    };
    loopNote = r.note;
  }

  // 1. Produce the machine's proposal. The loop input (if any) is fed to the
  //    draft's basis so the human reviews the SAME basis the final will
  //    reproduce. The evidence pre-state sensor (L3.S1) is bound to the SAME
  //    workspace the executor would actuate (--workspace), so the sensed
  //    pre-state describes the reality the decision will touch; without a
  //    named workspace it senses the process cwd (recorded verbatim). The OCD
  //    policy sensor (L3.S2) reads the SAME policy this CLI enforces
  //    (DEFAULT_CURSOR_POLICY), so a policy-violating proposal is visible in
  //    the basis the human reviews BEFORE ratification.
  const basisWorkspace = flags.workspace;
  const basisPolicy = DEFAULT_CURSOR_POLICY;
  // Replace pin (L4.S1): for a replace goal, sense the target file's current
  // content hash against the SAME root the evidence sensor uses (--workspace
  // or cwd) so the op the human reviews is anchored to the content they saw.
  // null for every non-replace goal / unsensable target — no pin fabricated.
  const replacePin = senseReplacePin(basisWorkspace ?? process.cwd(), goal);
  // Delete pin (A1): same discipline for a delete goal — the op the human
  // reviews is anchored to the content of the file they are approving the
  // deletion of. null for every non-delete goal / unsensable target.
  const deletePin = senseDeletePin(basisWorkspace ?? process.cwd(), goal);
  // Rename pin (R1): same discipline for a rename goal — the op the human
  // reviews is anchored to the SOURCE file content they saw, with the
  // destination verified unoccupied at sense time. null for every non-rename
  // goal / unsensable pair.
  const renamePin = senseRenamePin(basisWorkspace ?? process.cwd(), goal);
  let draft = await produceDraft(intent, loop, {
    basisWorkspace,
    basisPolicy,
    replacePin,
    deletePin,
    renamePin,
  });

  // AI_SEAMS_V1 seam 2 (L2.S3): the deterministic parser ran FIRST inside the
  // draft above (INV-AI-1). Only when it could not classify the goal, and only
  // for an interactive human session (never --json, never agents), consult the
  // bounded plan proposer ONCE. A valid candidate plan upgrades the draft to a
  // connected understanding whose ops are deterministic re-parse products of
  // the plan phrases; every failure keeps today's needs-input draft unchanged.
  let candidatePlan: CandidatePlanInput | null = null;
  let proposedSteps: readonly ProposedPlanStep[] = [];
  if (
    !flags.json &&
    isCliInteractive(io) &&
    evaluateElicitation(draft).status === "needs_input"
  ) {
    const steps = await consultCandidatePlan(goal);
    if (steps !== null && steps.length > 0) {
      const plan: CandidatePlanInput = { steps: steps.map((s) => s.phrase) };
      const planDraft = await produceDraft(intent, loop, {
        candidatePlan: plan,
        basisWorkspace,
        basisPolicy,
        // The goal did not parse (that is why we are here), so the pins are
        // necessarily null — threaded for uniformity, never sensed twice.
        replacePin,
        deletePin,
        renamePin,
      });
      if (evaluateElicitation(planDraft).status === "ready") {
        draft = planDraft;
        candidatePlan = plan;
        proposedSteps = steps;
      }
      // else: the kernel's own re-validation refused the plan — fail closed to
      // the deterministic needs-input draft (INV-AI-3).
    }
  }

  const storedDraft = store.appendDraft(draft);
  if (!flags.json) {
    if (proposedSteps.length > 0) printCandidatePlanNotice(io, proposedSteps);
    printRecord(io, "DRAFT", draft);
    io.out(
      `Stored draft ${storedDraft.record.recordId} (thread ${storedDraft.envelope.threadId})`,
    );
  }

  const elicitation = evaluateElicitation(draft);
  if (elicitation.status === "needs_input") {
    if (!flags.json) {
      printLoopOutcome(io, flags.from, loopNote, draft);
      io.out(
        `Needs input (${elicitation.basis}) -- this invocation is closed. Re-invoke with the ` +
          "answers as declared inputs:",
      );
      for (const q of elicitation.questions) io.out(`  ? ${q}`);
    }
    if (flags.approve || flags.reject) {
      return failOrErr(
        io,
        flags,
        "decide",
        "cannot ratify: the draft needs input (see the questions above)",
        "NEEDS_INPUT",
        1,
      );
    }
    if (flags.json) {
      return emitDecideJson(io, {
        status: "needs_input",
        recordId: storedDraft.record.recordId,
        goal,
        record: draft,
        references,
        message: "Additional information required before full projection.",
        nextSteps: [
          "Answer the elicitation questions in chat / re-call decide with answers as constraints or refs",
        ],
      });
    }
    return 0;
  }

  if (!flags.approve && !flags.reject) {
    if (!flags.json) {
      printLoopOutcome(io, flags.from, loopNote, draft);
      io.out(
        `No decision captured. Review with: usesteady show ${storedDraft.record.recordId}\n` +
          `Then ratify THIS draft with: usesteady ratify ${storedDraft.record.recordId} --approve|--reject`,
      );
    }
    if (flags.json) {
      return emitDecideJson(io, {
        status: "draft",
        recordId: storedDraft.record.recordId,
        goal,
        record: draft,
        references,
        message: `Draft ready. Review projection. Run \`usesteady ratify ${storedDraft.record.recordId} --approve\` to proceed.`,
        nextSteps: [
          "Review the projection above",
          "Add --ref if this depends on prior decisions",
          "Run ratify with --approve (TTY) or use Portal",
        ],
      });
    }
    return 0;
  }

  // AI_SEAMS_V1 seam 2: a decision flag on the SAME invocation that introduced a
  // model-proposed candidate plan would ratify a plan the human had not seen
  // when they typed --approve/--reject. Candidates require explicit review
  // (INV-AI-2): close this invocation and require a separate ratify of the
  // stored draft. Nothing executes here.
  if (candidatePlan !== null) {
    io.out(
      "This draft carries a model-proposed candidate plan you had not seen when\n" +
        "  passing --approve/--reject. Review the SYSTEM SUGGESTS steps above, then\n" +
        `  decide explicitly: usesteady ratify ${storedDraft.record.recordId} --approve|--reject` +
        (flags.execute && flags.workspace !== null
          ? ` --execute --workspace ${flags.workspace}`
          : ""),
    );
    return 0;
  }

  // 2. Capture the human decision (the ONE authorized write). Anchor it to the
  //    draft's stamped fingerprint — the surface reads it, never computes it.
  const fingerprint = ratifiableFingerprint(draft);
  if (fingerprint === null) {
    return failOrErr(
      io,
      flags,
      "decide",
      "cannot ratify: the draft has no stamped fingerprint (understanding/constitution unavailable)",
      "NOT_RATIFIABLE",
      1,
    );
  }

  // Claim the thread's ratification slot (atomic in-flight guard). For a
  // freshly-created thread this always succeeds. The durable single-ratification
  // truth is the stored final itself (a later `ratify` on this thread sees it and
  // refuses); the marker is released in `finally`.
  if (!store.tryClaimRatification(storedDraft.envelope.threadId)) {
    return failOrErr(
      io,
      flags,
      "decide",
      `thread ${storedDraft.envelope.threadId} is being ratified`,
      "CONFLICT",
      1,
    );
  }

  try {
    // Authoritative re-check under the lock. The thread is freshly minted here so
    // a collision is only possible if two identical-timestamp drafts produced the
    // same recordId (idempotent appendDraft then returns the same threadId to
    // both); the re-check makes even that case single-ratification safe.
    const finalNow = store
      .readAll()
      .find((s) => s.envelope.threadId === storedDraft.envelope.threadId && s.envelope.kind === "final");
    if (finalNow !== undefined) {
      return failOrErr(
        io,
        flags,
        "decide",
        `thread ${storedDraft.envelope.threadId} is already ratified`,
        "ALREADY_RATIFIED",
        1,
      );
    }

    // Seat the decision (S1): the persona provider is the only constructor of
    // the synthetic seat; the human seat records the TTY-proven approver. Both
    // flow through the identical produceFinal path — the swap is configuration.
    const humanDecision: HumanRatification =
      seat.kind === "persona"
        ? makePersonaRatification({
            personaId: seat.personaId,
            decision: flags.approve ? "approved" : "rejected",
            ratifiedFingerprint: fingerprint,
          })
        : {
            decision: flags.approve ? "approved" : "rejected",
            approver: flags.approver,
            approverKind: "human",
            ratifiedFingerprint: fingerprint,
          };

    // 3. Produce + store the immutable final, linked to the draft. The executor
    //    (if opted in) actuates only after the spine's fail-closed gate confirms
    //    approval; a rejected decision never reaches the executor.
    //    The pins sensed at decide time above ARE the pins the reviewed draft
    //    carries (same invocation, same objects) — threading them verbatim
    //    reproduces the draft's stamped fingerprint so the ratification
    //    anchors. Omitting them made this one-shot path refuse every pinned
    //    replace/delete with a fingerprint mismatch (fail-closed, but wrong).
    const final = await produceFinal(
      intent,
      humanDecision,
      {
        ...(exec.executor !== null ? { executor: exec.executor } : {}),
        ...(exec.realityProbe !== null ? { realityProbe: exec.realityProbe } : {}),
        ...(exec.scopeSensor !== null ? { scopeSensor: exec.scopeSensor } : {}),
        ...(exec.executor !== null ? { boundarySink: resolveBoundarySink(io) } : {}),
        ...(loop.priorObservation !== undefined ? { priorObservation: loop.priorObservation } : {}),
        ...(loop.priorObservationRef !== undefined ? { priorObservationRef: loop.priorObservationRef } : {}),
        ...(references.length > 0 ? { references } : {}),
        ...(replacePin !== null ? { replacePin } : {}),
        ...(deletePin !== null ? { deletePin } : {}),
        ...(renamePin !== null ? { renamePin } : {}),
        basisWorkspace,
        basisPolicy,
      },
    );
    const storedFinal = appendFinalLoud(
      io,
      store,
      final,
      storedDraft.envelope.threadId,
      storedDraft.record.recordId,
    );
    if (storedFinal === null) return 1;
    if (flags.json) {
      const rat = final.ratification;
      const approvedAt =
        rat.status === "connected" || rat.status === "derived" ? rat.value.at : nowIso();
      return emitJson(io, {
        schemaVersion: "1.0",
        command: "decide",
        status: "success",
        recordId: storedFinal.record.recordId,
        timestamp: nowIso(),
        data: {
          previousStatus: "awaiting_ratification",
          newStatus: flags.approve ? "approved" : "rejected",
          approvedBy: flags.approver === "cli" ? "tty-human" : flags.approver,
          approvedAt,
          executionPath: "local",
        },
        message: "Decision ratified. Execution may now proceed via existing Core path.",
        certification: localCertification(),
      });
    }
    printRecord(io, "FINAL", final);
    io.out(
      `Stored final ${storedFinal.record.recordId} (thread ${storedFinal.envelope.threadId})`,
    );
    printLoopOutcome(io, flags.from, loopNote, final);
    maybePrintOptInHint(io, flags, final);
    return 0;
  } finally {
    store.releaseRatificationClaim(storedDraft.envelope.threadId);
  }
}

async function cmdRatify(io: CliIO, args: readonly string[]): Promise<number> {
  const flags = parseFlags(args);
  const draftRecordId = flags.positionals[0];
  if (draftRecordId === undefined || draftRecordId.trim().length === 0) {
    return failOrErr(
      io,
      flags,
      "ratify",
      "ratify requires a draft recordId, e.g. usesteady ratify <recordId> --approve",
      "USAGE",
      2,
    );
  }

  const store = createGovernedDecisionStore(io.storeDir);
  const stored = store.getRecord(draftRecordId);
  if (stored === null) {
    return failOrErr(
      io,
      flags,
      "ratify",
      `no stored record with recordId ${draftRecordId}`,
      "NOT_FOUND",
      1,
    );
  }
  if (stored.envelope.kind !== "draft") {
    return failOrErr(
      io,
      flags,
      "ratify",
      `record ${draftRecordId} is a ${stored.envelope.kind}, not a draft — only drafts are ratified`,
      "USAGE",
      2,
    );
  }

  if (flags.json && !flags.approve && !flags.reject) {
    const projection = projectGovernedDecision(stored.record);
    const refs = referencesFromRecord(stored.record);
    return emitJson(io, {
      schemaVersion: "1.0",
      command: "ratify",
      status: "awaiting_ratification",
      recordId: draftRecordId,
      timestamp: nowIso(),
      data: {
        goal: typeof stored.record.humanIntent?.goal === "string" ? stored.record.humanIntent.goal : "",
        projection: buildDecideProjection(stored.record, projection),
        elicitation: elicitationQuestions(evaluateElicitation(stored.record)),
        refs: refsToJson(refs),
      },
      message: "Draft awaiting human ratification. Run with --approve in an interactive TTY.",
      nextSteps: [`usesteady ratify ${draftRecordId} --approve`],
      certification: localCertification(),
    });
  }

  if (flags.approve === flags.reject) {
    return failOrErr(
      io,
      flags,
      "ratify",
      "ratify requires exactly one of --approve / --reject",
      "USAGE",
      2,
    );
  }

  const seat = resolveRatifierSeat(flags);
  if ("error" in seat) {
    return failOrErr(io, flags, "ratify", seat.error, seat.code, 2);
  }

  const authErr = checkRatifyAuthority(io, flags, seat);
  if (authErr !== null) {
    if (flags.json) return emitJson(io, authErr);
    io.err(authErr.error?.message ?? "authority violation");
    return 2;
  }

  const exec = resolveExecutor(flags);
  if ("error" in exec) {
    return failOrErr(io, flags, "ratify", exec.error, "USAGE", 2);
  }
  // The loop reference is fixed at draft time. Accepting --from here could feed a
  // DIFFERENT basis than the human reviewed — silently breaking the draft↔final
  // basis equivalence. Refuse it; the draft's own priorObservationRef is inherited.
  if (flags.from !== null) {
    return failOrErr(
      io,
      flags,
      "ratify",
      "ratify does not take --from: the loop reference is inherited from the reviewed draft",
      "USAGE",
      2,
    );
  }
  if (flags.refs.length > 0) {
    return failOrErr(
      io,
      flags,
      "ratify",
      "ratify does not take --ref: declared references are inherited from the reviewed draft",
      "USAGE",
      2,
    );
  }

  // Reconstruct the intent from the STORED draft's own humanIntent — never
  // invented. The same intent reproduces the same constitution fingerprint, so
  // the human's decision anchors to exactly the draft they reviewed.
  const hi = stored.record.humanIntent as { goal?: unknown; constraints?: unknown } | undefined;
  const goal = hi !== undefined && typeof hi.goal === "string" ? hi.goal : null;
  if (goal === null) {
    return failOrErr(
      io,
      flags,
      "ratify",
      `stored draft ${draftRecordId} has no readable goal — cannot ratify`,
      "NOT_RATIFIABLE",
      1,
    );
  }
  const constraints = Array.isArray(hi?.constraints)
    ? hi.constraints.filter((c): c is string => typeof c === "string")
    : [];
  const intent: HumanIntent = { goal, constraints };

  const fingerprint = ratifiableFingerprint(stored.record);
  if (fingerprint === null) {
    return failOrErr(
      io,
      flags,
      "ratify",
      `draft ${draftRecordId} has no stamped fingerprint — cannot ratify`,
      "NOT_RATIFIABLE",
      1,
    );
  }

  // Single-ratification, same two layers as the HTTP path (shared store):
  // 1. DURABLE — an existing final already decided this thread (self-healing,
  //    independent of any marker). 2. TRANSIENT — the atomic claim guards the
  //    in-flight window; released in `finally`.
  const existingFinal = store
    .readAll()
    .find((s) => s.envelope.threadId === stored.envelope.threadId && s.envelope.kind === "final");
  if (existingFinal !== undefined) {
    return failOrErr(
      io,
      flags,
      "ratify",
      `thread ${stored.envelope.threadId} is already ratified`,
      "ALREADY_RATIFIED",
      1,
    );
  }
  if (!store.tryClaimRatification(stored.envelope.threadId)) {
    return failOrErr(
      io,
      flags,
      "ratify",
      `thread ${stored.envelope.threadId} is being ratified`,
      "CONFLICT",
      1,
    );
  }

  try {
    // Authoritative re-check under the lock (the pre-claim read is a stale
    // snapshot; another ratify may have completed before we won the claim).
    const finalNow = store
      .readAll()
      .find((s) => s.envelope.threadId === stored.envelope.threadId && s.envelope.kind === "final");
    if (finalNow !== undefined) {
      return failOrErr(
        io,
        flags,
        "ratify",
        `thread ${stored.envelope.threadId} is already ratified`,
        "ALREADY_RATIFIED",
        1,
      );
    }

    // Seat the decision (S1): persona via the sanctioned provider (namespace +
    // typed provenance enforced), human via the TTY-proven flags. Identical
    // kernel path either way (INV-SO-1: the swap is configuration).
    const humanDecision: HumanRatification =
      seat.kind === "persona"
        ? makePersonaRatification({
            personaId: seat.personaId,
            decision: flags.approve ? "approved" : "rejected",
            ratifiedFingerprint: fingerprint,
          })
        : {
            decision: flags.approve ? "approved" : "rejected",
            approver: flags.approver,
            approverKind: "human",
            ratifiedFingerprint: fingerprint,
          };

    // Inherit the automatic-loop input from the reviewed draft so the final's
    // basis reproduces EXACTLY what the human reviewed. The draft persisted
    // priorObservationRef IFF a prior observation was eligible and fed its basis;
    // re-resolving it now reconstructs the same evidence.
    //
    // Defensive normalization: a record persisted before this field existed loads
    // from JSON with `priorObservationRef` absent (runtime `undefined`). Treat
    // undefined / empty exactly like `null` (no loop) so legacy drafts ratify
    // normally instead of resolving a bogus "recordId undefined".
    let loop: LoopInput = {};
    const inheritedRef =
      typeof stored.record.priorObservationRef === "string" &&
      stored.record.priorObservationRef.length > 0
        ? stored.record.priorObservationRef
        : null;
    if (inheritedRef !== null) {
      const r = resolvePriorObservation(store, inheritedRef);
      if ("error" in r) {
        return failOrErr(
          io,
          flags,
          "ratify",
          `cannot reproduce the reviewed basis: ${r.error}`,
          "NOT_RATIFIABLE",
          1,
        );
      }
      loop = { priorObservation: r.priorObservation, priorObservationRef: r.priorObservationRef };
    }

    // Inherit the DECLARED references from the reviewed draft so the final's basis
    // (and thus its certification) reproduces EXACTLY what the human reviewed. A
    // prior_observation edge matching the inherited loop ref is reproduced via the
    // loop path above, so it is excluded here to avoid a double-counted edge.
    const inheritedReferences = referencesFromRecord(stored.record).filter(
      (r) => !(r.kind === "prior_observation" && r.ref === inheritedRef),
    );

    // AI_SEAMS_V1 seam 2: reproduce the reviewed candidate plan (when the draft
    // carries a phrase-representable one) so the final's understanding — and the
    // stamped fingerprint the decision anchors to — matches EXACTLY what the
    // human reviewed. Deterministic reconstruction; the understanding port
    // ignores it for parser-parseable goals, so passing it is always safe.
    const inheritedPlan = candidatePlanFromRecord(stored.record);
    // Replace pin (L4.S1) + delete pin (A1): reconstructed VERBATIM from the
    // reviewed draft — never re-sensed — so the final's fingerprint anchors to
    // exactly the pinned op the human reviewed. A file that changed since the
    // pin was sensed is refused by the executor's hash gate, honestly, per-op.
    const inheritedPin = replacePinFromRecord(stored.record);
    const inheritedDeletePin = deletePinFromRecord(stored.record);
    const inheritedRenamePin = renamePinFromRecord(stored.record);

    const final = await produceFinal(
      intent,
      humanDecision,
      {
        ...(exec.executor !== null ? { executor: exec.executor } : {}),
        ...(exec.realityProbe !== null ? { realityProbe: exec.realityProbe } : {}),
        ...(exec.scopeSensor !== null ? { scopeSensor: exec.scopeSensor } : {}),
        ...(exec.executor !== null ? { boundarySink: resolveBoundarySink(io) } : {}),
        ...(loop.priorObservation !== undefined ? { priorObservation: loop.priorObservation } : {}),
        ...(loop.priorObservationRef !== undefined ? { priorObservationRef: loop.priorObservationRef } : {}),
        ...(inheritedReferences.length > 0 ? { references: inheritedReferences } : {}),
        ...(inheritedPlan !== null ? { candidatePlan: inheritedPlan } : {}),
        ...(inheritedPin !== null ? { replacePin: inheritedPin } : {}),
        ...(inheritedDeletePin !== null ? { deletePin: inheritedDeletePin } : {}),
        ...(inheritedRenamePin !== null ? { renamePin: inheritedRenamePin } : {}),
        // Evidence pre-state (L3.S1): re-sensed at ratify time against the
        // executor's workspace (--workspace) or cwd. The basis stage runs
        // before execution, so this records the reality that existed at the
        // moment of ratification — still pre-state. The OCD policy sensor
        // (L3.S2) re-reads the same CLI-enforced policy.
        basisWorkspace: flags.workspace,
        basisPolicy: DEFAULT_CURSOR_POLICY,
      },
    );
    // Link the final to the SAME thread as the reviewed draft.
    const storedFinal = appendFinalLoud(
      io,
      store,
      final,
      stored.envelope.threadId,
      stored.record.recordId,
    );
    if (storedFinal === null) return 1;
    if (flags.json) {
      const rat = final.ratification;
      const approvedAt =
        rat.status === "connected" || rat.status === "derived" ? rat.value.at : nowIso();
      return emitJson(io, {
        schemaVersion: "1.0",
        command: "ratify",
        status: "success",
        recordId: storedFinal.record.recordId,
        timestamp: nowIso(),
        data: {
          previousStatus: "awaiting_ratification",
          newStatus: flags.approve ? "approved" : "rejected",
          approvedBy: flags.approver === "cli" ? "tty-human" : flags.approver,
          approvedAt,
          executionPath: "local",
        },
        message: "Decision ratified. Execution may now proceed via existing Core path.",
        certification: localCertification(),
      });
    }
    printRecord(io, "FINAL", final);
    io.out(
      `Stored final ${storedFinal.record.recordId} (thread ${storedFinal.envelope.threadId})`,
    );
    printLoopOutcome(io, inheritedRef, null, final);
    maybePrintOptInHint(io, flags, final);
    return 0;
  } finally {
    store.releaseRatificationClaim(stored.envelope.threadId);
  }
}

function cmdDecisions(io: CliIO, args: readonly string[]): number {
  const flags = parseFlags(args);
  const store = createGovernedDecisionStore(io.storeDir);
  const threads = store.listThreads();
  if (flags.json) {
    return emitJson(io, {
      schemaVersion: "1.0",
      command: "decisions",
      status: "success",
      recordId: null,
      timestamp: nowIso(),
      data: {
        threads: threads.map((t) => ({
          threadId: t.threadId,
          draftRecordId: t.draftRecordId,
          finalRecordId: t.finalRecordId,
          ratifiedDecision: t.ratifiedDecision,
          goal: t.goal,
        })),
      },
      message:
        threads.length === 0 ? "No decisions yet." : `${threads.length} decision thread(s).`,
      certification: localCertification(),
    });
  }
  if (threads.length === 0) {
    io.out("No decisions yet.");
    return 0;
  }
  io.out(`${threads.length} decision thread(s):`);
  for (const t of threads) {
    io.out(
      `  ${t.threadId}  draft=${t.draftRecordId ?? "-"}  final=${t.finalRecordId ?? "-"}  ` +
        `decision=${t.ratifiedDecision ?? "pending"}  goal="${t.goal}"`,
    );
  }
  return 0;
}

function cmdShow(io: CliIO, args: readonly string[]): number {
  const flags = parseFlags(args);
  const recordId = flags.positionals[0];
  if (recordId === undefined || recordId.trim().length === 0) {
    return failOrErr(
      io,
      flags,
      "show",
      "show requires a recordId, e.g. usesteady show <recordId>",
      "USAGE",
      2,
    );
  }
  const store = createGovernedDecisionStore(io.storeDir);
  const stored = store.getRecord(recordId);
  if (stored === null) {
    return failOrErr(
      io,
      flags,
      "show",
      `no stored record with recordId ${recordId}`,
      "NOT_FOUND",
      1,
    );
  }
  if (flags.json) {
    const projection = projectGovernedDecision(stored.record);
    return emitJson(io, {
      schemaVersion: "1.0",
      command: "show",
      status: "success",
      recordId,
      timestamp: nowIso(),
      data: {
        record: {
          recordId: stored.record.recordId,
          threadId: stored.envelope.threadId,
          kind: stored.envelope.kind,
          goal:
            typeof stored.record.humanIntent?.goal === "string"
              ? stored.record.humanIntent.goal
              : "",
        },
        projection,
      },
      certification: localCertification(),
    });
  }
  printRecord(io, `${stored.envelope.kind.toUpperCase()} (thread ${stored.envelope.threadId})`, stored.record);
  return 0;
}

/**
 * Print the certified invocation lineage rooted at a stored record: the chain of
 * declared references (A -> B -> C) walked across the store, each node's
 * certification level, each edge's authority band, and any unresolved references.
 * Read-only over the store; asserts no authority.
 */
function cmdLineage(io: CliIO, args: readonly string[]): number {
  const flags = parseFlags(args);
  const recordId = flags.positionals[0];
  if (recordId === undefined || recordId.trim().length === 0) {
    return failOrErr(
      io,
      flags,
      "lineage",
      "lineage requires a recordId, e.g. usesteady lineage <recordId>",
      "USAGE",
      2,
    );
  }
  const store = createGovernedDecisionStore(io.storeDir);
  const lineage = buildInvocationLineage(store.readAll(), recordId);
  if (lineage === null) {
    return failOrErr(
      io,
      flags,
      "lineage",
      `no stored record with recordId ${recordId}`,
      "NOT_FOUND",
      1,
    );
  }
  if (flags.json) {
    return emitJson(io, {
      schemaVersion: "1.0",
      command: "lineage",
      status: "success",
      recordId,
      timestamp: nowIso(),
      data: lineageToJsonData(lineage),
      certification: localCertification(),
    });
  }
  for (const line of renderLineageLines(lineage)) io.out(line);
  return 0;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

/**
 * Run the governed-decision CLI. Returns a process exit code. Never throws —
 * any unexpected error degrades to an error line + exit code 1, mirroring the
 * never-throws discipline of the projection/store read paths.
 */
export async function runGovernedDecisionCli(
  argv: readonly string[],
  io: CliIO,
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return 0;
  }

  try {
    switch (command) {
      case "decide":
        return await cmdDecide(io, rest);
      case "ratify":
        return await cmdRatify(io, rest);
      case "decisions":
        return cmdDecisions(io, rest);
      case "show":
        return cmdShow(io, rest);
      case "lineage":
        return cmdLineage(io, rest);
      default:
        io.err(`unknown command: ${command}`);
        io.err(USAGE);
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`error: ${message}`);
    return 1;
  }
}

// ─── Direct execution (npx tsx src/governed-decision/cli.ts ...) ──────────────

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void runGovernedDecisionCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  }).then((code) => {
    process.exitCode = code;
  });
}
