/**
 * W-E2 — Deterministic derivation from ratified portal steps (Fix B).
 *
 * Approved portal step summaries are re-parsed through the frozen deterministic
 * parser into canonical phrases. No fresh decide / no model on the goal blob.
 *
 * NO_SILENT_CONTENT_OMISSION: when a step claims file content, the body MUST
 * pin onto a summaryOnly create_file anchor. Never fall back to empty `touch`
 * (hollow SCM blob + false evidence agree). Unpinned claims return
 * `content_pin_failed` so Portal/H sees a visible refusal — not planning-only
 * demotion and not silent empty success.
 */

import { normalizeIntent } from "../../understand/interpretation/intent.js";
import { isSafeRelativePlanPath } from "../../intake/candidate-plan.js";
import {
  pinFileContentFromSummary,
  summaryClaimsFileContent,
  type CandidatePlanInput,
} from "../../governed-decision/stages/understanding.js";

export type PortalStepAnchor = {
  readonly index: number;
  readonly title: string;
  readonly summary: string;
  readonly status: "approved" | "rejected" | "pending";
};

export type DerivePortalStepsResult =
  | { readonly ok: true; readonly plan: CandidatePlanInput }
  | { readonly ok: false; readonly code: "content_pin_failed" | "not_derivable" };

const MAX_STEPS = 5;

const PLANNING_ACTIONS = new Set([
  "define",
  "verify",
  "document",
  "plan",
  "assess",
  "establish",
  "conduct",
  "recruit",
  "run",
  "score",
  "publish",
  "validate",
  "review",
  "clarify",
  "confirm",
  "sequence",
  "identify",
  "gather",
  "examine",
  "design",
  "prepare",
]);

function stepActionPrefix(title: string): string | null {
  const match = title.trim().match(/^([a-z]+)\s*:/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** WorkPlan scaffold steps (define/verify/...) may skip when no FS phrase is found. */
function isPlanningOnlyStep(step: PortalStepAnchor): boolean {
  const action = stepActionPrefix(step.title);
  if (action === null) return false;
  if (action === "create" || action === "add") return false;
  return PLANNING_ACTIONS.has(action);
}

function extractPathHints(text: string): readonly string[] {
  const hints: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return hints;

  // Em-dash / unicode dash (WorkPlan prose separators). Optional
  // "folder|directory" label after the dash: "— folder utils-fs-a2a".
  const emDashMatch = trimmed.match(
    /(?:\u2014|—)\s+(?:(?:folder|directory|dir)\s+)?([A-Za-z0-9_./-]+)\s*$/i,
  );
  if (emDashMatch?.[1]) hints.push(emDashMatch[1]);

  // ASCII hyphen only as a spaced separator (" - path"), never mid-token
  // ("utils-fs-a2a" must not yield hint "fs-a2a").
  const spacedDashMatch = trimmed.match(
    /\s-\s+(?:(?:folder|directory|dir)\s+)?([A-Za-z0-9_./-]+)\s*$/i,
  );
  if (spacedDashMatch?.[1]) hints.push(spacedDashMatch[1]);

  const calledMatch = trimmed.match(
    /(?:folder|directory)\s+(?:called|named)\s+['"]?([A-Za-z0-9_./-]+)['"]?/i,
  );
  if (calledMatch?.[1]) hints.push(calledMatch[1]);

  const createMatch = trimmed.match(
    /\bcreate\s+(?:a\s+)?(?:folder|directory)\s+(?:called\s+)?['"]?([A-Za-z0-9_./-]+)['"]?/i,
  );
  if (createMatch?.[1]) hints.push(createMatch[1]);

  const mkdirMatch = trimmed.match(/\bmkdir\s+([A-Za-z0-9_./-]+)/i);
  if (mkdirMatch?.[1]) hints.push(mkdirMatch[1]);

  return hints;
}

function phraseCandidates(step: PortalStepAnchor): readonly string[] {
  const summary = step.summary.trim();
  const title = step.title.trim();
  const combined = `${title} ${summary}`.trim();

  const candidates: string[] = [];
  const push = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length > 0) candidates.push(trimmed);
  };

  push(summary);
  push(title);
  if (combined.length > 0 && combined !== summary && combined !== title) {
    push(combined);
  }

  for (const source of [title, summary, combined]) {
    for (const hint of extractPathHints(source)) {
      push(`mkdir ${hint}`);
      push(`create folder ${hint}`);
      push(`create directory ${hint}`);
    }
  }

  if (summary.length > 0 && !summary.toLowerCase().includes("folder")) {
    push(`create folder ${summary}`);
    push(`mkdir ${summary}`);
  }

  return [...new Set(candidates)];
}

function stepToPhrase(step: PortalStepAnchor): string | null {
  for (const candidate of phraseCandidates(step)) {
    const parsed = normalizeIntent(candidate);
    if (parsed === null) continue;
    if (parsed.kind !== "create_dir" && parsed.kind !== "create_file") continue;
    if (!isSafeRelativePlanPath(parsed.path)) continue;
    if (parsed.kind === "create_dir") return `mkdir ${parsed.path}`;
    return `touch ${parsed.path}`;
  }
  return null;
}

/** True when a ratified portal step asserts a specific file body. */
function stepClaimsExplicitFileContent(step: PortalStepAnchor): boolean {
  return summaryClaimsFileContent(`${step.title} ${step.summary}`);
}

/**
 * Rebuild a summary-only scaffold line so understanding pins reviewed content
 * onto create_file (same invariant as adopted V2). Never invent paths or bodies.
 * Returns null when the step claims content but the body cannot be pinned.
 */
function phraseToContentPinnedAnchor(phrase: string, step: PortalStepAnchor): string | null {
  let path: string | null = null;
  if (phrase.startsWith("mkdir ")) path = phrase.slice("mkdir ".length).trim();
  else if (phrase.startsWith("touch ")) path = phrase.slice("touch ".length).trim();
  if (path === null || path.length === 0) return null;
  const outcome = step.summary.trim().length > 0 ? step.summary.trim() : "exists";
  const anchor = `[repo_change] create: ${path} — ${outcome}`;
  // Directory scaffolds never need a body pin.
  const base = path.split("/").pop() ?? path;
  if (!base.includes(".")) return anchor;
  if (!stepClaimsExplicitFileContent(step)) return anchor;
  if (pinFileContentFromSummary(anchor) === null) return null;
  return anchor;
}

function dedupeConsecutive(phrases: readonly string[]): string[] {
  const out: string[] = [];
  for (const phrase of phrases) {
    if (out.length === 0 || out[out.length - 1] !== phrase) {
      out.push(phrase);
    }
  }
  return out;
}

/**
 * Derive a candidate plan from approved portal steps.
 *
 * Content-bearing file creates: pin MUST succeed for every claim, or this
 * returns `content_pin_failed` (visible handoff refusal). Never silently
 * demote to empty `touch` phrases.
 */
export function deriveCandidatePlanFromPortalSteps(
  steps: readonly PortalStepAnchor[],
): DerivePortalStepsResult {
  const approved = steps
    .filter((s) => s.status === "approved")
    .sort((a, b) => a.index - b.index);
  if (approved.length === 0 || approved.length > MAX_STEPS) {
    return { ok: false, code: "not_derivable" };
  }

  const phrases: string[] = [];
  let hasNonPlanningFailure = false;

  for (const step of approved) {
    const phrase = stepToPhrase(step);
    if (phrase !== null) {
      phrases.push(phrase);
    } else if (!isPlanningOnlyStep(step)) {
      hasNonPlanningFailure = true;
    }
  }

  if (phrases.length === 0 || hasNonPlanningFailure) {
    return { ok: false, code: "not_derivable" };
  }

  const anyContentClaim = approved.some(stepClaimsExplicitFileContent);
  if (anyContentClaim) {
    const anchors: string[] = [];
    for (const step of approved) {
      const phrase = stepToPhrase(step);
      if (phrase === null) {
        if (!isPlanningOnlyStep(step)) {
          return { ok: false, code: "not_derivable" };
        }
        continue;
      }
      const anchor = phraseToContentPinnedAnchor(phrase, step);
      if (anchor === null) {
        // NO_SILENT_CONTENT_OMISSION — refuse empty-touch fallback.
        return { ok: false, code: "content_pin_failed" };
      }
      anchors.push(anchor);
    }
    const deduped = dedupeConsecutive(anchors);
    if (deduped.length === 0 || deduped.length > MAX_STEPS) {
      return { ok: false, code: "not_derivable" };
    }
    return { ok: true, plan: { steps: deduped, summaryOnly: true } };
  }

  const deduped = dedupeConsecutive(phrases);
  if (deduped.length === 0 || deduped.length > MAX_STEPS) {
    return { ok: false, code: "not_derivable" };
  }

  return { ok: true, plan: { steps: deduped } };
}

export function readPortalStepAnchors(body: unknown): readonly PortalStepAnchor[] | null {
  if (body === null || typeof body !== "object") return null;
  const raw = (body as { portal_steps?: unknown }).portal_steps;
  if (!Array.isArray(raw)) return null;

  const out: PortalStepAnchor[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const index = row["index"];
    const title = typeof row["title"] === "string" ? row["title"] : "";
    const summary = typeof row["summary"] === "string" ? row["summary"] : "";
    const status = row["status"];
    if (typeof index !== "number" || !Number.isInteger(index)) return null;
    if (status !== "approved" && status !== "rejected" && status !== "pending") return null;
    out.push({ index, title, summary, status });
  }
  return out;
}
