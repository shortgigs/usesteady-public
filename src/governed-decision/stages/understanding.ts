/**
 * Understanding stage adapter — spine port v1.
 *
 * Connects the existing deterministic intent parser
 * (src/understand/interpretation/intent.ts) to the governed-decision spine's
 * understanding port.
 *
 * ── Seam decision: deterministic-first; injected candidate plan as fallback ───
 *
 *   `normalizeIntent()` is always called first. It is fully deterministic: no
 *   LLM, no network, no filesystem access. When it parses, its result is the
 *   understanding — an injected candidate plan is IGNORED (deterministic wins).
 *
 *   AI_SEAMS_V1 seam 2 (L2.S3): a surface MAY inject a candidate plan via
 *   `makeUnderstandingPort(plan)`. The plan is plain data (canonical phrases),
 *   NEVER a model handle — this module performs no model calls and imports no
 *   SDK. Every phrase is re-parsed through the same deterministic parser and
 *   must land in the NON-DESTRUCTIVE executable subset; any failure degrades
 *   the section to "unavailable" (fail-closed, INV-AI-3/INV-AI-6). Because the
 *   section is a pure function of (goal, constraints, plan phrases), a final
 *   run injected with the plan reconstructed from the reviewed draft reproduces
 *   the identical constitution fingerprint — ratification anchoring holds.
 *
 *   With no plan injected (`understandingPort`), behavior is EXACTLY the v1
 *   deterministic-only port: parser null → honestly "unavailable". We never
 *   fabricate an intent or plan.
 *
 * ── UNKNOWN preservation ───────────────────────────────────────────────────────
 *
 *   The deterministic parser has a binary outcome: it either produces a fully-
 *   resolved ParsedIntent (all required fields present) or returns null (no safe
 *   classification). There is no partial-UNKNOWN success state in the current
 *   parser, so `unknowns[]` is always empty when the section is "connected".
 *
 *   If the parser is later extended to emit partial unknowns (e.g. path
 *   inferred but content unknown), this adapter must thread them through to
 *   `unknowns[]` rather than defaulting them away.
 *
 * ── Gauge law: Invented is unrepresentable ─────────────────────────────────────
 *
 *   - "connected" → real parsed intent from the deterministic parser.
 *   - "unavailable" → parser returned null; no plan fabricated.
 *   - "derived" → not used here (no derivation from prior sections needed).
 */

import type { DecisionSection, UnderstandingPayload, ExecutableOperation } from "../types.js";
import type { BaseStageContext } from "../pipeline.js";
import type { FileReplacePin } from "./replace-pin.js";
import type { FileDeletePin } from "./delete-pin.js";
import type { FileRenamePin } from "./rename-pin.js";
import {
  normalizeIntent,
  describeIntent,
  type ParsedIntent,
} from "../../understand/interpretation/intent.js";

/**
 * Map a parsed intent to the kernel's executable operation, or `undefined`
 * when the intent has no operation in the executable subset.
 *
 * create_dir and create_file are carried unconditionally (the v1
 * non-destructive subset). A `replace` intent (L4.S1) is carried ONLY when the
 * surface injected a {@link FileReplacePin} sensed for the SAME path — the pin
 * supplies the content-addressed anchors (expectedPriorSha256 /
 * expectedPostSha256) that bind the approval to the file content the human
 * actually saw. Without a matching pin (file absent, unreadable, `find` not
 * present, or the surface sensed nothing), the replace intent still produces a
 * connected understanding with a human-readable plan but NO structured op —
 * exactly the pre-L4.S1 behavior. This port never reads the filesystem; the
 * pin is injected data.
 *
 * A `delete` intent (A1 residual) follows the same pin discipline: carried
 * ONLY when the surface injected a {@link FileDeletePin} sensed for the SAME
 * path — the pin supplies the content-addressed pre-state anchor
 * (expectedPriorSha256) that binds the approval to the file content the human
 * actually saw. Without a matching pin (target absent, not a regular file, or
 * the surface sensed nothing), the delete intent produces a connected
 * understanding with a human-readable plan but NO structured op — exactly the
 * pre-A1 behavior.
 *
 * A `rename` intent (R1) follows the same pin discipline: carried ONLY when
 * the surface injected a {@link FileRenamePin} sensed for the SAME
 * source/destination pair — the pin supplies the content-addressed pre-state
 * anchor of the SOURCE file. Without a matching pin (source absent, not a
 * regular file, destination occupied, or the surface sensed nothing), the
 * rename intent produces a connected understanding with a human-readable plan
 * but NO structured op — exactly the pre-R1 behavior. Never fabricates an
 * operation the parser did not produce.
 */
function toExecutableOperation(
  parsed: ParsedIntent,
  replacePin: FileReplacePin | null,
  deletePin: FileDeletePin | null,
  renamePin: FileRenamePin | null,
): ExecutableOperation | undefined {
  switch (parsed.kind) {
    case "create_dir":
      return { kind: "create_dir", path: parsed.path };
    case "create_file":
      // ParsedIntent.content is optional; an absent body is a real empty file,
      // not a fabricated value.
      return { kind: "create_file", path: parsed.path, content: parsed.content ?? "" };
    case "replace":
      if (replacePin !== null && replacePin.path === parsed.file) {
        return {
          kind: "replace_in_file",
          path: parsed.file,
          find: parsed.find,
          replaceWith: parsed.replace,
          expectedPriorSha256: replacePin.expectedPriorSha256,
          expectedPostSha256: replacePin.expectedPostSha256,
        };
      }
      return undefined;
    case "delete":
      if (deletePin !== null && deletePin.path === parsed.path) {
        return {
          kind: "delete_file",
          path: parsed.path,
          expectedPriorSha256: deletePin.expectedPriorSha256,
        };
      }
      return undefined;
    case "rename":
      if (renamePin !== null && renamePin.fromPath === parsed.from && renamePin.toPath === parsed.to) {
        return {
          kind: "rename_file",
          path: parsed.from,
          toPath: parsed.to,
          expectedPriorSha256: renamePin.expectedPriorSha256,
        };
      }
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Derive a factual context summary from the human-supplied constraints.
 * Does NOT invent context. If constraints are empty, states that honestly.
 */
function buildContextSummary(constraints: readonly string[]): string {
  if (constraints.length === 0) return "No additional constraints specified.";
  return `Constraints: ${constraints.join("; ")}.`;
}

// ─── Candidate plan input (AI_SEAMS_V1 seam 2 — L2.S3) ─────────────────────────

/**
 * A surface-supplied candidate plan: canonical deterministic phrases only
 * (`mkdir <path>` / `touch <path>`). Plain data — carries no model handle and
 * no authority. This port re-parses every phrase itself; it trusts nothing.
 *
 * W-E3 / B.S1: when `summaryOnly` is true, `steps` are human-reviewed task
 * summaries from an adopted Candidate Plan V2. They are NEVER passed through
 * `normalizeIntent` (clarify/define must not invent FS ops).
 */
export type CandidatePlanInput = {
  readonly steps: readonly string[];
  readonly summaryOnly?: boolean;
};

/** Upper bound mirrors the FS proposer's bound (src/intake/candidate-plan.ts). */
const MAX_PLAN_STEPS = 5;

/**
 * Adopted Candidate Plan V2 summaryOnly handoff — mirrors
 * MAX_ADOPTED_V2_HANDOFF_STEPS / Candidate Plan V2 MAX_PLAN_TASKS (8).
 * Must stay above the FS Fix B bound so Path B marketplace plans (≤8) draft.
 */
const MAX_SUMMARY_ONLY_PLAN_STEPS = 8;

/**
 * Extract a concrete relative path from a B.S1 summary-only line
 * (`[repo_change] create: src/foo.ts — …`). Paths are taken verbatim from the
 * human-reviewed summary — never invented (CP-6).
 */
function scaffoldPathFromSummary(summary: string): string | null {
  const afterClass = summary.replace(
    /^\[(?:repo_change|document|human|cli|external)\]\s*/i,
    "",
  );
  const afterAction = afterClass.includes(":")
    ? afterClass.slice(afterClass.indexOf(":") + 1).trim()
    : afterClass.trim();
  const pathMatch = afterAction.match(
    /^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/,
  );
  if (!pathMatch?.[1]) return null;
  const path = pathMatch[1].replace(/\/+$/, "");
  return path.length > 0 ? path : null;
}

/**
 * Outcome / verification prose after the deliverable path on a summary-only
 * line. Human-reviewed text only — never invented (CP-6).
 */
function scaffoldOutcomeFromSummary(summary: string): string {
  const em = summary.lastIndexOf("\u2014"); // —
  if (em >= 0) return summary.slice(em + 1).trim();
  const ascii = summary.lastIndexOf(" - ");
  if (ascii >= 0) return summary.slice(ascii + 3).trim();
  return summary;
}

/**
 * Strip portal plan-acceptance-cue suffix so content pin sees the outcome body.
 * Accepts current label ("How we'll know") and legacy "Verified by" on persisted
 * summaries (PLAN_VS_REALITY_A_COPY_V1). Not Evidence Engine vocabulary.
 */
function stripVerifiedBySuffix(text: string): string {
  return text
    .replace(/\s*[·•]\s*(?:How we'll know|Verified by):.*$/i, "")
    .trim();
}

/**
 * NO_SILENT_CONTENT_OMISSION — when a reviewed step claims file content, the
 * body MUST pin onto create_file or the handoff/execution path fails closed
 * with an explicit content_pin_failed signal. Never scaffold content:"" and
 * claim delivery/evidence success (hollow empty blob e69de29 class).
 *
 * Claim detection is structural, not an endless phrase chase:
 *   1) known outcome/cue phrases, OR
 *   2) content vocabulary + a non-empty quoted body somewhere in the line
 *      (covers novel model phrasing; pin still required or fail closed).
 */
const PHRASE_CONTENT_CLAIM =
  /\b(?:exact content|contains(?:ing)?(?:\s+the\s+text|\s+exactly)|with(?:\s+the)?(?:\s+specified(?:\s+text)?)?\s+content|specified text content)\b/i;

const CONTENT_VOCAB =
  /\b(?:content|contains|containing|exact(?:ly)?|specified)\b/i;

/** Prefixes that immediately precede a quoted or bare body. */
const CONTENT_CLAIM_PREFIX =
  /\b(?:exact content|contains(?:ing)?(?:\s+the\s+text|\s+exactly)|with(?:\s+the)?(?:\s+specified(?:\s+text)?)?\s+content)\s*:?\s*/i;

export const CONTENT_PIN_FAILED_REASON =
  "content claim present but body could not be pinned onto create_file";

function firstQuotedBody(text: string): string | null {
  const m = /['"`]([^'"`]+)['"`]/.exec(text);
  if (m?.[1] === undefined) return null;
  const body = m[1].trim();
  return body.length > 0 ? body : null;
}

/**
 * Quoted body that appears at/after content vocabulary — avoids pinning a
 * path quote like create 'foo.md' when the real body is later (or absent).
 */
function quotedBodyAfterContentVocab(text: string): string | null {
  const vocab = CONTENT_VOCAB.exec(text);
  if (vocab === null || vocab.index === undefined) return null;
  return firstQuotedBody(text.slice(vocab.index));
}

function summaryClaimsExplicitFileContent(summary: string): boolean {
  if (PHRASE_CONTENT_CLAIM.test(summary)) return true;
  return quotedBodyAfterContentVocab(summary) !== null;
}

/**
 * Extract explicit file body from a human-reviewed summary-only line.
 * Returns null when no content claim is present OR when a claim is present
 * but cannot be parsed (caller must fail closed on the latter — visibly, not
 * by demoting the work item to planning-only).
 *
 * Patterns mirror Candidate Plan V2 outcome / verificationCue phrasing —
 * including Kimi-style `exact content: body` (optional colon) and
 * `contains exactly 'body'`. Last resort: first non-empty quoted span when a
 * structural claim is already established.
 */
function scaffoldContentFromSummary(summary: string): string | null {
  if (!summaryClaimsExplicitFileContent(summary)) return null;

  // Prefer outcome / verification prose; also scan the full line so a claim
  // before the em-dash (or in an appended verificationCue) still pins.
  const haystacks = [
    stripVerifiedBySuffix(scaffoldOutcomeFromSummary(summary)),
    stripVerifiedBySuffix(summary),
  ];

  for (const haystack of haystacks) {
    if (haystack.length === 0) continue;

    const quoted = new RegExp(
      CONTENT_CLAIM_PREFIX.source + "['\"`]([^'\"`]+)['\"`]",
      "i",
    ).exec(haystack);
    if (quoted?.[1] !== undefined) {
      const body = quoted[1].trim();
      if (body.length > 0) return body;
    }

    // Unquoted body: stop at middle-dot / plan-cue label / end.
    // Skip "specified text content" alone — body lives in the cue quote.
    const unquoted = new RegExp(
      CONTENT_CLAIM_PREFIX.source + "(.+?)(?:\\s*[·•]\\s*|\\s*$)",
      "i",
    ).exec(haystack);
    if (unquoted?.[1] !== undefined) {
      // Unquoted bodies often sit in prose ("… authority-smoke-grok. · How we'll
      // know: …"). Strip a trailing sentence period/excl/quest so the pin is the
      // token, not the punctuation. Quoted bodies stay byte-exact above.
      const body = unquoted[1]
        .trim()
        .replace(/^['"`]|['"`]$/g, "")
        .replace(/[.!?]+$/u, "");
      if (
        body.length > 0 &&
        !/^(?:specified(?:\s+text)?\s+)?content$/i.test(body)
      ) {
        return body;
      }
    }

    // Cue-only quoted body after a claim like "specified text content"
    // (quote may not sit immediately after the claim prefix).
    const cueQuoted =
      /\bcontains exactly\s+['"`]([^'"`]+)['"`]/i.exec(haystack) ??
      /\b(?:with(?:\s+the)?\s+content|exact content)\s*:?\s*['"`]([^'"`]+)['"`]/i.exec(
        haystack,
      );
    if (cueQuoted?.[1] !== undefined) {
      const body = cueQuoted[1].trim();
      if (body.length > 0) return body;
    }

    // Structural last resort once a claim is established: quoted body after
    // content vocabulary (not an earlier path quote).
    const structural = quotedBodyAfterContentVocab(haystack);
    if (structural !== null) return structural;
  }

  return null;
}

/** Exported for handoff error classification + unit coverage of pin phrases. */
export function pinFileContentFromSummary(summary: string): string | null {
  return scaffoldContentFromSummary(summary);
}

export function summaryClaimsFileContent(summary: string): boolean {
  return summaryClaimsExplicitFileContent(summary);
}

/**
 * Defense-in-depth for NO_SILENT_CONTENT_OMISSION: a connected understanding
 * must never carry create_file content:"" when the reviewed summary claimed a
 * body. Returns an explicit reason when hollow delivery would otherwise succeed.
 */
export function hollowContentOmissionReason(
  candidatePlans: readonly { readonly summary: string; readonly operation?: ExecutableOperation }[],
): string | null {
  for (const plan of candidatePlans) {
    const op = plan.operation;
    if (op === undefined || op.kind !== "create_file") continue;
    if (!summaryClaimsExplicitFileContent(plan.summary)) continue;
    if (op.content === "") {
      return (
        `content_pin_failed: approved step claims file content but create_file ` +
        `for ${op.path} has empty body — refusing hollow delivery`
      );
    }
  }
  return null;
}

function scaffoldOpFromPath(path: string, content: string): ExecutableOperation {
  const base = path.split("/").pop() ?? path;
  if (!base.includes(".")) {
    return { kind: "create_dir", path };
  }
  return { kind: "create_file", path, content };
}

type SummaryOnlyPlanEntry = UnderstandingPayload["candidatePlans"][number];

/**
 * Models (notably Grok) often split "create file" + "file contains X" into two
 * summary-only lines on the SAME path. SCM fail-closes on duplicate targets in
 * one commit (`duplicate target path… not actuated`), so nothing lands and
 * reality stays empty/unknown — a hollow full-loop FAIL.
 *
 * Coalesce create_file ops by path: prefer non-empty content; conflicting
 * non-empty bodies fail closed (return null). Other op kinds are left alone.
 */
function coalesceSamePathCreateFilePlans(
  plans: readonly SummaryOnlyPlanEntry[],
): readonly SummaryOnlyPlanEntry[] | null {
  const out: SummaryOnlyPlanEntry[] = [];
  const fileIndexByPath = new Map<string, number>();

  for (const plan of plans) {
    const op = plan.operation;
    if (op === undefined || op.kind !== "create_file") {
      out.push(plan);
      continue;
    }
    const key = op.path.replace(/\/+$/, "");
    const existingIdx = fileIndexByPath.get(key);
    if (existingIdx === undefined) {
      fileIndexByPath.set(key, out.length);
      out.push(plan);
      continue;
    }
    const existing = out[existingIdx]!;
    const existingOp = existing.operation;
    if (existingOp === undefined || existingOp.kind !== "create_file") {
      out.push(plan);
      continue;
    }
    const prior = existingOp.content;
    const next = op.content;
    if (prior.length > 0 && next.length > 0 && prior !== next) {
      return null;
    }
    const content = next.length > 0 ? next : prior;
    const summary =
      existing.summary === plan.summary
        ? existing.summary
        : `${existing.summary}; ${plan.summary}`;
    out[existingIdx] = {
      id: existing.id,
      summary,
      operation: { kind: "create_file", path: existingOp.path, content },
    };
  }
  return out;
}

/**
 * Deterministically re-validate an injected candidate plan into an
 * UnderstandingPayload, or null when ANY phrase fails re-parse or falls
 * outside the non-destructive executable subset (fail-closed — a partial plan
 * is never fabricated).
 *
 * When `plan.summaryOnly` is true (W-E3 adopted V2 anchor), skip the parser
 * for clarify/define prose. CP REV_1: path-bearing summary lines (including
 * mis-tagged `[document]` scaffolds) become create_file/create_dir ops so the
 * FS/SCM executor can actuate after H ratify (still no invented paths). Pure
 * prose human/document plans without paths keep attestation / document-record.
 */
function payloadFromCandidatePlan(
  plan: CandidatePlanInput,
  constraints: readonly string[],
): UnderstandingPayload | null {
  const maxSteps =
    plan.summaryOnly === true ? MAX_SUMMARY_ONLY_PLAN_STEPS : MAX_PLAN_STEPS;
  if (plan.steps.length === 0 || plan.steps.length > maxSteps) return null;

  if (plan.summaryOnly === true) {
    const candidatePlans: UnderstandingPayload["candidatePlans"][number][] = [];
    const summaries: string[] = [];
    const hasRepoChange = plan.steps.some((s) =>
      /^\[repo_change\]/i.test(s.trim()),
    );
    const hasPathBearing = plan.steps.some(
      (s) => scaffoldPathFromSummary(s.trim()) !== null,
    );
    // Any concrete path the human reviewed is a scaffold — including when the
    // model tagged every file create as `document` (prod poison after #1006).
    const useScaffoldOps = hasRepoChange || hasPathBearing;
    for (let i = 0; i < plan.steps.length; i++) {
      const summary = plan.steps[i]!.trim();
      if (summary.length === 0) return null;
      summaries.push(summary);
      if (useScaffoldOps) {
        const path = scaffoldPathFromSummary(summary);
        if (path !== null) {
          const base = path.split("/").pop() ?? path;
          const isFile = base.includes(".");
          // Content-claiming create_file must pin the reviewed body onto the
          // executable op. Empty scaffold + reality agree was a hollow success
          // (whitespace-only SCM PR) that poisoned replay / institutional memory.
          if (isFile && summaryClaimsExplicitFileContent(summary)) {
            const content = scaffoldContentFromSummary(summary);
            if (content === null) return null; // fail closed — never hollow empty
            candidatePlans.push({
              id: `candidate-step-${i + 1}`,
              summary,
              operation: scaffoldOpFromPath(path, content),
            });
          } else {
            candidatePlans.push({
              id: `candidate-step-${i + 1}`,
              summary,
              operation: scaffoldOpFromPath(path, ""),
            });
          }
        } else {
          candidatePlans.push({ id: `candidate-step-${i + 1}`, summary });
        }
        continue;
      }
      // W-E5/W-E6: human/document summaries carry structured ops so the
      // matching executor can run after H ratify. Never invent FS paths.
      const humanMatch = summary.match(/^\[human\]\s*(.+)$/i);
      const documentMatch = summary.match(/^\[document\]\s*(.+)$/i);
      if (humanMatch?.[1]) {
        candidatePlans.push({
          id: `candidate-step-${i + 1}`,
          summary,
          operation: {
            kind: "human_attest",
            path: `attest/step-${i + 1}`,
            statement: humanMatch[1].trim(),
            executorClass: "human",
          },
        });
      } else if (documentMatch?.[1]) {
        candidatePlans.push({
          id: `candidate-step-${i + 1}`,
          summary,
          operation: {
            kind: "document_record",
            path: `document/step-${i + 1}`,
            statement: documentMatch[1].trim(),
            executorClass: "document",
          },
        });
      } else {
        candidatePlans.push({ id: `candidate-step-${i + 1}`, summary });
      }
    }
    const coalesced = coalesceSamePathCreateFilePlans(candidatePlans);
    if (coalesced === null) return null;
    const fsOpCount = coalesced.filter(
      (p) =>
        p.operation?.kind === "create_file" || p.operation?.kind === "create_dir",
    ).length;
    return {
      intent:
        fsOpCount > 0
          ? `Adopted candidate plan (${coalesced.length} step(s), summary-only anchor, ${fsOpCount} scaffold op(s)): ${summaries.join("; ")}`
          : `Adopted candidate plan (${coalesced.length} step(s), summary-only anchor, no FS derivation): ${summaries.join("; ")}`,
      contextSummary: buildContextSummary(constraints),
      candidatePlans: coalesced,
      unknowns: [],
    };
  }

  const candidatePlans: UnderstandingPayload["candidatePlans"][number][] = [];
  const summaries: string[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    const phrase = plan.steps[i]!;
    const parsed = normalizeIntent(phrase);
    if (parsed === null) return null;
    // Candidate plans stay strictly in the NON-DESTRUCTIVE subset (INV-A1-3):
    // no pin is ever supplied here, so a replace, delete, or rename phrase
    // yields no op and the whole plan fails closed below. Model-proposed
    // content modification, destruction, or relocation is out of scope.
    const operation = toExecutableOperation(parsed, null, null, null);
    // INV-AI-6: only the non-destructive executable subset may enter a
    // candidate plan — a step without a structured op would be presented as
    // executable but never actuate, a dishonest surface.
    if (operation === undefined) return null;

    const summary = describeIntent(parsed);
    summaries.push(summary);
    candidatePlans.push({ id: `candidate-step-${i + 1}`, summary, operation });
  }

  return {
    intent: `Candidate plan (${candidatePlans.length} step(s), model-proposed, deterministically re-validated): ${summaries.join("; ")}`,
    contextSummary: buildContextSummary(constraints),
    candidatePlans,
    unknowns: [],
  };
}

/**
 * Reconstruct the candidate-plan input from a STORED record's understanding
 * section, or null when the record does not carry a phrase-representable plan
 * (e.g. a create_file with content, or no executable ops at all).
 *
 * Used by ratification surfaces so `produceFinal` reproduces EXACTLY the
 * understanding the human reviewed — the port's deterministic-first rule makes
 * this injection a no-op for parser-parseable goals, so it is always safe to
 * pass the reconstruction when it exists.
 */
export function candidatePlanFromRecord(
  record: { readonly understanding?: unknown },
): CandidatePlanInput | null {
  const section = record.understanding as
    | { status?: unknown; value?: { candidatePlans?: unknown } }
    | undefined;
  if (section === undefined || section.status !== "connected") return null;
  const plans = section.value?.candidatePlans;
  if (!Array.isArray(plans) || plans.length === 0) return null;

  const steps: string[] = [];
  let anyOp = false;
  let anySummaryOnly = false;

  for (const p of plans) {
    const plan = p as { summary?: unknown; operation?: ExecutableOperation };
    const summaryText =
      typeof plan.summary === "string" && plan.summary.trim().length > 0
        ? plan.summary.trim()
        : null;
    // Prefer B.S1 / CP REV_1 class-prefixed summaries so produceFinal
    // re-enters the summaryOnly path and keeps the ratified fingerprint.
    if (
      summaryText !== null &&
      /^\[(repo_change|document|human|cli|external)\]/i.test(summaryText)
    ) {
      anySummaryOnly = true;
      steps.push(summaryText);
      continue;
    }
    const op = plan.operation;
    if (op !== undefined) {
      if (op.kind === "create_dir") {
        anyOp = true;
        steps.push(`mkdir ${op.path}`);
      } else if (op.kind === "create_file" && op.content === "") {
        anyOp = true;
        steps.push(`touch ${op.path}`);
      } else if (op.kind === "human_attest") {
        // Reconstruct the B.S1 summary-only wire form so produceFinal matches.
        anySummaryOnly = true;
        steps.push(`[human] ${op.statement}`);
      } else if (op.kind === "document_record") {
        anySummaryOnly = true;
        steps.push(`[document] ${op.statement}`);
      } else {
        // Content-bearing create_file (or a future op kind) is not
        // phrase-representable — no reconstruction. Callers fall back to the
        // plain deterministic final, exactly as before this seam existed.
        return null;
      }
    } else if (summaryText !== null) {
      anySummaryOnly = true;
      steps.push(summaryText);
    } else {
      return null;
    }
  }

  // Mixed FS phrase ops + summary-only is not a coherent reconstruction.
  if (anyOp && anySummaryOnly) return null;
  if (anySummaryOnly) return { steps, summaryOnly: true };
  return { steps };
}

/**
 * Build the understanding port, optionally carrying an injected candidate plan
 * (AI_SEAMS_V1 seam 2), an injected replace pin (L4.S1), an injected delete
 * pin (A1), and/or an injected rename pin (R1). Behavior:
 *
 *   1. Deterministic parser FIRST (INV-AI-1). If it parses, the result is the
 *      understanding — the injected plan is ignored entirely. A `replace`
 *      parse produces a structured op only when `replacePin` matches the
 *      parsed target path; a `delete` parse only when `deletePin` matches; a
 *      `rename` parse only when `renamePin` matches the parsed
 *      source/destination pair (see toExecutableOperation).
 *
 *   2. Parser null + plan injected → the plan is deterministically re-validated
 *      (every phrase re-parsed; ops restricted to the non-destructive subset).
 *      Valid → connected section built purely from the re-parse products.
 *      Invalid → unavailable with an explicit fail-closed reason.
 *
 *   3. Parser null + no plan → unavailable (the v1 honest default, unchanged).
 *
 * The pins are plain injected data (content-addressed hashes), so the section
 * stays a pure function of (goal, constraints, plan, pins) — fingerprint
 * reproducibility between draft and final holds when the ratifying surface
 * injects the pin reconstructed from the reviewed draft
 * (replacePinFromRecord / deletePinFromRecord / renamePinFromRecord), never a
 * re-sensed one.
 *
 * Error path: wraps unexpected exceptions so the spine is never thrown into.
 */
export function makeUnderstandingPort(
  plan: CandidatePlanInput | null,
  replacePin: FileReplacePin | null = null,
  deletePin: FileDeletePin | null = null,
  renamePin: FileRenamePin | null = null,
): (ctx: BaseStageContext) => Promise<DecisionSection<UnderstandingPayload>> {
  return async (ctx: BaseStageContext): Promise<DecisionSection<UnderstandingPayload>> => {
    try {
      // W-E3 / B.S1: summary-only adopted V2 anchor — never call normalizeIntent
      // on the goal or on clarify/define task text.
      if (plan !== null && plan.summaryOnly === true) {
        const fromPlan = payloadFromCandidatePlan(plan, ctx.humanIntent.constraints);
        if (fromPlan !== null) {
          return { status: "connected", value: fromPlan };
        }
        // Content claimed but unparseable must NOT be framed as planning-only
        // (that hides Start execution). Surface an explicit pin failure reason.
        const contentPinFailed = plan.steps.some((step) => {
          const summary = step.trim();
          if (!summaryClaimsExplicitFileContent(summary)) return false;
          const path = scaffoldPathFromSummary(summary);
          if (path === null) return false;
          const base = path.split("/").pop() ?? path;
          if (!base.includes(".")) return false;
          return scaffoldContentFromSummary(summary) === null;
        });
        return {
          status: "unavailable",
          reason: contentPinFailed
            ? CONTENT_PIN_FAILED_REASON
            : "adopted candidate plan failed summary-only validation: every step must carry a non-empty summary",
        };
      }

      const parsed = normalizeIntent(ctx.humanIntent.goal);

      if (parsed === null) {
        if (plan !== null) {
          const fromPlan = payloadFromCandidatePlan(plan, ctx.humanIntent.constraints);
          if (fromPlan !== null) {
            return { status: "connected", value: fromPlan };
          }
          return {
            status: "unavailable",
            reason:
              "candidate plan failed deterministic re-validation: no step may fall outside the frozen non-destructive subset",
          };
        }
        return {
          status: "unavailable",
          reason:
            "no safe interpretation of intent: the deterministic parser could not classify the goal",
        };
      }

      const intentDescription = describeIntent(parsed);
      const contextSummary = buildContextSummary(ctx.humanIntent.constraints);
      const operation = toExecutableOperation(parsed, replacePin, deletePin, renamePin);

      const value: UnderstandingPayload = {
        intent: intentDescription,
        contextSummary,
        candidatePlans: [
          {
            id: parsed.kind,
            summary: intentDescription,
            // Omit the key entirely when there is no executable op (gauge law +
            // exactOptionalPropertyTypes): absent, not a fabricated default.
            ...(operation !== undefined ? { operation } : {}),
          },
        ],
        // The deterministic parser is fully-resolving: when it succeeds, all
        // required fields are present. unknowns[] is empty, not defaulted away —
        // it is genuinely absent. See UNKNOWN preservation note in the file header.
        unknowns: [],
      };

      return { status: "connected", value };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        reason: `understanding extraction failed: ${message}`,
      };
    }
  };
}

/**
 * Run the deterministic understanding extraction (no injected plan) — the v1
 * behavior, byte-for-byte. Kept as a named function for existing callers.
 */
export const buildUnderstandingSection = makeUnderstandingPort(null);

/**
 * Convenience alias so the adapter can be passed directly as
 * `ports.understanding` in a `runGovernedDecisionSpine()` call.
 */
export const understandingPort = buildUnderstandingSection;
