import { PROSPECTIVE_APPROVAL_IDENTITIES } from './prospective-approval-identities.js';
import { canonicalJson, validateLaneCharter } from './charter.js';
/**
 * Lane pre-flight — Gate 2 of LANE_GOVERNANCE_BY_USESTEADY_V1.
 *
 * At session start, the session's declared intent is evaluated against the
 * RATIFIED charter: planned paths vs allowed/forbidden path rules, plus the
 * frozen ControlEnvelope compilation (forbidden runtime terms, plan-summary
 * requirement). Deterministic; blocked is terminal (INV-LG-2, inheriting
 * INV-CE-2/-5).
 *
 * ── Boundary: src/control is consumed FROZEN ──────────────────────────────────
 *
 *   The artifact's anti-scope forbids changes to ControlEnvelope semantics
 *   (INV-CE-1..5 consumed frozen). This module therefore LAYERS on top of
 *   `compileControlEnvelope` instead of extending it:
 *
 *     1. Refuse an unratified or invalid charter outright (INV-LG-1 — no
 *        ratified charter, no lane; nothing is even compiled).
 *     2. Compile the envelope through the frozen compiler, verbatim input.
 *     3. Evaluate the session's planned files against the charter's path
 *        rules for the session repo (same matching semantics as Gate 3).
 *     4. Combine: the session may proceed to the approval surface ONLY when
 *        the envelope is not blocked AND the path evaluation is in-charter.
 *
 *   The returned envelope is the compiler's output, untouched. The charter
 *   verdict rides beside it in {@link LanePreflightResult} — this module
 *   never rewrites `approval.status` inside the envelope, so INV-CE
 *   consumers keep seeing exactly what the compiler said.
 *
 * ── What blocked means here ───────────────────────────────────────────────────
 *
 *   `status: "blocked"` is terminal for the SESSION: no code may be written
 *   under this lane until a new pre-flight passes (typically after the
 *   operator revises the plan, or a revised charter goes back through
 *   Gate 1). There is no bypass, no partial session (INV-LG-2). And per
 *   INV-LG-4 the enforcement claim stays honest: pre-flight governs the
 *   session's DECLARED intent; the landing gate that no violation can pass
 *   is Gate 3's scope probe at PR.
 */

import { compileControlEnvelope, type CompileInput } from "../control/compiler.js";
import type { ControlEnvelope } from "../control/types.js";
import {
  evaluatePathsAgainstCharter,
  scopeForRepo,
  charterContentSha256,
  type PathEvaluation,
  type StoredLaneCharter,
} from "./charter.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LanePreflightInput = {
  /** The ratified stored charter governing this lane (Gate 1 output). */
  readonly storedCharter: StoredLaneCharter;
  /** The repo slug this session operates in (must be covered by the charter). */
  readonly repoSlug: string;
  /** The session's build request, compiled through the frozen ControlEnvelope. */
  readonly compile: CompileInput;
};

export type LanePreflightResult = {
  /**
   * Terminal combined verdict. "blocked" → no session; "pending" → the
   * envelope proceeds to its normal approval surface (Gate 2 never approves;
   * approval authority is unchanged).
   */
  readonly status: "blocked" | "pending";
  /** All blocking reasons, fail-full (empty iff status is "pending"). */
  readonly reasons: readonly string[];
  /** The frozen compiler's envelope, untouched. Null when the charter itself was refused. */
  readonly envelope: ControlEnvelope | null;
  /** The charter path evaluation. Null when the charter itself was refused. */
  readonly pathEvaluation: PathEvaluation | null;
};

// ─── Charter admission (INV-LG-1 / INV-LG-5) ──────────────────────────────────

/**
 * Refusal reasons for a stored charter that cannot govern a session. Checked
 * before anything is compiled. Fail-full: all detectable reasons reported.
 */
export function charterAdmissionErrors(stored: StoredLaneCharter): readonly string[] {
  const errors: string[] = [];
  const valid = validateLaneCharter(stored.charter);
  if (!valid.ok) return valid.errors;
  const actualHash = charterContentSha256(stored.charter);
  if (stored.contentSha256 !== actualHash) {
    errors.push(
      `charter content hash mismatch: stored ${stored.contentSha256}, actual ${actualHash} (body changed after hashing)`,
    );
  }
  if (stored.ratification == null) {
    errors.push("charter is not ratified (INV-LG-1: no ratified charter, no lane)");
  } else {
    const r = stored.ratification;
    if ('kind' in r || PROSPECTIVE_APPROVAL_IDENTITIES.some(e => e.laneId === stored.charter.laneId)) {
      const approved = PROSPECTIVE_APPROVAL_IDENTITIES.find(e => e.laneId === stored.charter.laneId);
      if (!approved || approved.contentSha256 !== actualHash || canonicalJson(approved.evidence) !== canonicalJson(r)) errors.push('prospective founder evidence does not match approved identity');
    } else if (r.recordId.trim().length === 0 || r.ratifiedFingerprint.trim().length === 0) {
      errors.push("charter ratification evidence is incomplete (recordId / ratifiedFingerprint required)");
    }
    if (r.approverKind !== "human" && r.approverKind !== "persona") {
      errors.push(`charter ratification approverKind must be "human" or "persona" (INV-SO-2)`);
    }
    if (stored.charter.productionLane && r.approverKind !== "human") {
      errors.push(
        'production lane requires approverKind "human" (INV-LG-5: a persona-ratified charter is a build-lane fact)',
      );
    }
    const isPersonaNamespace = r.approver.startsWith("persona:");
    if (r.approverKind === "persona" && !isPersonaNamespace) {
      errors.push('persona ratification must identify inside the "persona:" namespace (INV-SO-2)');
    }
    if (r.approverKind === "human" && isPersonaNamespace) {
      errors.push('human ratification must not identify inside the "persona:" namespace (INV-SO-2)');
    }
  }
  return errors;
}

// ─── Gate 2 ───────────────────────────────────────────────────────────────────

/**
 * Run the Gate 2 pre-flight for one session. Deterministic; never throws on
 * well-typed input; blocked is terminal (INV-LG-2).
 */
export function preflightLaneSession(input: LanePreflightInput): LanePreflightResult {
  // 1. Charter admission — an unratified/tampered charter compiles nothing.
  const admissionErrors = charterAdmissionErrors(input.storedCharter);
  if (admissionErrors.length > 0) {
    return {
      status: "blocked",
      reasons: admissionErrors,
      envelope: null,
      pathEvaluation: null,
    };
  }

  const charter = input.storedCharter.charter;
  const scope = scopeForRepo(charter, input.repoSlug);
  if (scope === null) {
    return {
      status: "blocked",
      reasons: [
        `charter ${charter.laneId} does not cover repo ${input.repoSlug} — a lane session in an uncovered repo is out-of-charter`,
      ],
      envelope: null,
      pathEvaluation: null,
    };
  }

  // 2. Frozen ControlEnvelope compilation (verbatim input; INV-CE-1..5 apply).
  const envelope = compileControlEnvelope(input.compile);

  // 3. Charter path evaluation over the session's DECLARED planned files —
  //    same matching semantics Gate 3 enforces on the actual diff at PR.
  const pathEvaluation = evaluatePathsAgainstCharter(scope, input.compile.plannedChanges.files);

  // 4. Combine, fail-full: every blocking reason is reported together.
  const reasons: string[] = [];
  if (envelope.approval.status === "blocked") {
    reasons.push(`control envelope blocked: ${envelope.approval.reason ?? "unspecified"}`);
  }
  if (pathEvaluation.verdict === "out-of-charter") {
    for (const v of pathEvaluation.violations) {
      reasons.push(`out-of-charter path: ${v}`);
    }
  }

  return {
    status: reasons.length > 0 ? "blocked" : "pending",
    reasons,
    envelope,
    pathEvaluation,
  };
}
