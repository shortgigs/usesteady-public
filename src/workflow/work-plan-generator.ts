/**
 * Deterministic WorkPlan generator — USESTEADY_WORKPLAN_GENERATION_V1
 *
 * Template selection + contract grounding. Fail-closed. No LLM sampling.
 */

import { createHash } from "node:crypto";
import type { ConfirmedUnderstandingV1 } from "../portal-bridge/confirmed-understanding-handoff.js";
import type {
  DeliverableType,
  WorkPlan,
  WorkPlanSourceRef,
  WorkPlanTask,
} from "./work-plan-types.js";
import {
  isolateIntentFromConfirmed,
  isolateIntentFromRatifiedGoal,
} from "./isolated-intent.js";
import { parseAnalysisAsk, type AnalysisAsk } from "./business-intent-routing.js";
import {
  FORBIDDEN_TEMPLATE_ACTIONS,
  getTemplate,
  PHASE_TEMPLATES,
  resolveOutcome,
  resolveTarget,
} from "./work-plan-templates.js";

type DeliverableClassification = {
  readonly type: DeliverableType;
  readonly sourceSpan: WorkPlanSourceRef;
};

const TYPE_PATTERNS: readonly { type: DeliverableType; pattern: RegExp }[] = [
  { type: "characterization",    pattern: /characterization|characterize/i },
  { type: "research_initiative", pattern: /research initiative|llm evaluation|no implementation plan|research project/i },
  { type: "program_migration",   pattern: /migration initiative|phased migration|migrate/i },
  { type: "capability_setup",    pattern: /authentication middleware|rate-limit|public api endpoints|middleware|capability/i },
  { type: "refactor_scope",      pattern: /button styling|theme tokens|rebrand|refactor/i },
  { type: "structure_scaffold",  pattern: /utils|date helper|\bscaffold\b|\bdirectory\b|\bstructure\b/i },
];

function findSpanInGoalText(goalText: string, pattern: RegExp): WorkPlanSourceRef | null {
  const match = pattern.exec(goalText);
  if (!match || match.index === undefined) return null;
  return {
    ref:    "rawInput",
    start:  match.index,
    end:    match.index + match[0].length,
  };
}

function classifyDeliverableFromGoal(
  goalText: string,
  goalSourceRef: WorkPlanSourceRef,
): DeliverableClassification {
  for (const { type, pattern } of TYPE_PATTERNS) {
    if (pattern.test(goalText)) {
      const span = findSpanInGoalText(goalText, pattern) ?? goalSourceRef;
      return { type, sourceSpan: span };
    }
  }
  return { type: "planning", sourceSpan: goalSourceRef };
}

/** Closed blocklist — first token is NOT stripped as a verb when in this set. */
const NON_VERB_OPENERS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "its",
  "i", "we", "you", "they", "he", "she", "my", "our", "your", "their",
  "why", "what", "when", "where", "who", "whom", "whose", "which", "how",
  "is", "are", "was", "were", "am", "be", "being", "been",
  "do", "does", "did", "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "has", "have", "had", "if", "and", "or", "but", "so", "because", "let", "let's",
]);

const PREAMBLE_PATTERN =
  /^(i\s+(?:want|need|would like|'d like)\s+to\s+|help\s+me\s+(?:to\s+)?|we\s+(?:need|want)\s+to\s+|please\s+)/i;

const PURPOSE_CLAUSE_PATTERN =
  /\s+(?:to|in order to|so(?:\s+that)?|so\s+we\s+can)\s+\S.*$/i;

/**
 * Requester-frame pattern — structural detection only.
 * Matches: "I/We [modal]..." or "Our/The [noun(s)] [modal]..."
 * This is NOT a content keyword list — it detects the syntactic STRUCTURE
 * of requester framing (first-person pronoun + desiderative modal verb).
 * After a match the remainder is the operative intent (deliverable + purpose).
 */
const REQUESTER_FRAME_PATTERN =
  /^(?:(?:i|we)\s+(?:need[s]?|want[s]?|would like|are looking for)\s+|(?:our|the)\s+(?:\w+\s+){0,4}(?:need[s]?|want[s]?)\s+)/i;

/**
 * BIC-6 — Bare proper-noun subject frame ("Sales needs X", "HR needs X").
 * Complements REQUESTER_FRAME_PATTERN for department/team names that aren't
 * preceded by "our/the". Requires exactly one or two capitalized words before
 * "needs/need" to avoid over-matching general sentence starts.
 * NOTE: Applied only when REQUESTER_FRAME_PATTERN has already failed.
 */
const PROPER_NOUN_SUBJECT_FRAME_PATTERN =
  /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+needs?\s+/;

/**
 * Role-noun extraction from "Our NOUN need[s]" frames.
 * Used to recover the beneficiary ("agents") from "Our agents need X" and
 * inject it back into the goal subject ("X for agents"). Generic collective
 * nouns (team, company, etc.) are excluded — they add no specificity.
 */
const ROLE_NOUN_FROM_FRAME_PATTERN = /^(?:our|the)\s+(.+?)\s+needs?$/i;
const GENERIC_ROLE_NOUNS = new Set([
  "team", "company", "organization", "organisation", "business",
  "staff", "group", "people", "everyone", "us",
]);

/**
 * BIC-1 — Impersonal conditional capability wish.
 * "It would help/be great if ACTOR could VERB-PHRASE" → capability frame.
 * "It would be great if ACTOR got NOUN-PHRASE" → deliverable frame.
 * Structural anchor: "could" or "got" signals a concrete capability or
 * deliverable, not just an outcome wish ("churn was lower" = copula only).
 */
const BIC1_FRAME_PATTERN =
  /^it\s+would\s+(?:help|be\s+great)\s+if\s+/i;
const BIC1_CAPABILITY_PATTERN =
  /^(.+?)\s+(could|got)\s+(.+)$/i;

/** First-person actors — stripped from BIC-1 system framing since "we" = requester. */
const FIRST_PERSON_ACTORS = new Set(["i", "we", "us"]);

/**
 * BIC-6 infinitive complement transform.
 * "to [verb] ..." after a requester frame is an infinitive purpose phrase —
 * it cannot stand alone as a deliverable subject ("Create to know ...").
 * Wrap it in "a system to ..." to form a well-shaped noun phrase.
 * Exception: "to a/an/the ..." is already an article-led noun phrase.
 */
const INFINITIVE_COMPLEMENT_PATTERN = /^to\s+(?!(?:a|an|the)\s)/i;

/** "a way to X" bridge — replace implicit "way" with generic deliverable "system". */
const WAY_TO_BRIDGE_PATTERN = /^a\s+way\s+to\s+/i;

/**
 * Post-leadVerb delivery check — detects "a/an/the [noun] to [purpose]" structure.
 * When an operator preamble ("I want to build") strips a verb but leaves an
 * article-led noun + purpose complement, the purpose complement belongs to the
 * deliverable description and must not be stripped.
 */
const ARTICLE_LED_DELIVERY_PATTERN = /^(?:a|an|the)\s+\S+.*?\s+to\s+\S/i;

export type NormalizedSubject = {
  readonly subject: string;
  readonly leadVerb: string | null;
  readonly defaulted: boolean;
};

function tokenAlpha(token: string): string {
  return token.replace(/[^a-zA-Z-]/g, "");
}

function passesMinimumResidual(residual: string): boolean {
  const trimmed = residual.trim();
  if (trimmed.length === 0) return false;

  const words = trimmed.split(/\s+/);
  if (words.length < 2) return false;

  const nonSpaceChars = trimmed.replace(/\s/g, "").length;
  if (nonSpaceChars < 6) return false;

  return words.some(w => {
    const alpha = tokenAlpha(w);
    if (alpha.length < 3) return false;
    return !NON_VERB_OPENERS.has(alpha.toLowerCase());
  });
}

function capitalizeFirst(token: string): string {
  if (token.length === 0) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function firstToken(s: string): { original: string; lower: string } | null {
  const match = /^\s*(\S+)/.exec(s);
  if (!match) return null;
  const original = match[1]!;
  const alpha = tokenAlpha(original);
  if (alpha.length === 0) return null;
  return { original, lower: alpha.toLowerCase() };
}

function stripFirstToken(s: string): string {
  return s.replace(/^\s*\S+\s*/, "").trim();
}

/**
 * Verb-agnostic subject normalization — USESTEADY_WORKPLAN_SUBJECT_NORMALIZATION_V1.
 * Pure function: identical input → identical { subject, leadVerb, defaulted }.
 *
 * Business intent extensions:
 *
 * V1 (USESTEADY_BUSINESS_INTENT_EXTRACTION_IMPL_V1):
 * Requester frames stripped; purpose complement preserved.
 *
 * V2 (USESTEADY_BUSINESS_INTENT_EXTRACTION_IMPL_V2):
 * - BIC-1: "It would help/be great if X could/got Y" stripped and reshaped
 *   into "a system for X to Y" (capability) or "Y for X" (deliverable-got).
 *   Outcome-only conditionals ("churn was lower") are NOT matched — no "could/got".
 * - BIC-6 (infinitive complement): "to VERB ..." after frame strip →
 *   "a system to VERB ..." to avoid malformed "Create to know ..." goals.
 * - BIC-6 (role noun): "Our agents need X" → subject becomes "X for agents"
 *   so beneficiary survives into the goal. Generic nouns (team, company) excluded.
 * - BIC-6 (bare proper-noun): "Sales needs X" → frame stripped like V1.
 * - BIC-7: "Set up" as phrasal verb preserved intact; purpose clause retained.
 *
 * All detection is structural only — no keyword lists.
 */
export function normalizeSubject(rawInput: string): NormalizedSubject {
  const fallback = rawInput.trim();
  let s = fallback;

  // Strip trailing sentence punctuation early so patterns don't trip on it.
  s = s.replace(/[.!?]+$/, "").trim();

  let hasBusinessFrame = false;

  // BIC-1: Impersonal conditional capability wish (before preamble/requester checks).
  // "It would help/be great if ACTOR could VERB-PHRASE" or "... ACTOR got NOUN-PHRASE"
  // Only fires when the if-clause contains "could" or "got" — the structural marker
  // for a named capability. Outcome-only ("churn was lower") lacks this marker.
  if (BIC1_FRAME_PATTERN.test(s)) {
    const withoutFrame = s.replace(BIC1_FRAME_PATTERN, "").trim();
    const capMatch = BIC1_CAPABILITY_PATTERN.exec(withoutFrame);
    if (capMatch) {
      const actor    = capMatch[1]!.trim();
      const modal    = capMatch[2]!.toLowerCase();
      const vp       = capMatch[3]!.trim();
      if (modal === "could") {
        // "could VERB-PHRASE" → "a system to VERB-PHRASE" (first person)
        //                     → "a system for ACTOR to VERB-PHRASE" (third person)
        if (FIRST_PERSON_ACTORS.has(actor.toLowerCase())) {
          s = "a system to " + vp;
        } else {
          s = "a system for " + actor + " to " + vp;
        }
      } else {
        // "got NOUN-PHRASE" → "NOUN-PHRASE for ACTOR"
        s = vp + " for " + actor;
      }
      hasBusinessFrame = true;
    }
  }

  // Step 1: PREAMBLE ("I want to X", "We need to X" operator-style).
  // Applied first since PREAMBLE handles the "to-infinitive after modal" form
  // which does NOT carry a deliverable noun before the purpose complement.
  const preambleMatch = !hasBusinessFrame ? PREAMBLE_PATTERN.exec(s) : null;
  if (preambleMatch) {
    s = s.slice(preambleMatch[0].length).trim();
    // "be able to [action]" is an idiomatic continuation of the requester frame
    // (e.g. "We want to be able to log X and route Y").  Treat the verbal action
    // as the operative content and add an implicit system deliverable.
    const beAbleTo = /^be\s+able\s+to\s+/i.exec(s);
    if (beAbleTo) {
      s = "a system to " + s.slice(beAbleTo[0].length).trim();
      hasBusinessFrame = true;
    }
  }

  // Step 2: Requester frame — V1 pronouns/team OR V2 bare proper-noun subject.
  // Only runs if neither BIC-1 nor PREAMBLE fired.
  if (!hasBusinessFrame && !preambleMatch) {
    const frameMatch = REQUESTER_FRAME_PATTERN.exec(s);
    if (frameMatch) {
      const afterFrame = s.slice(frameMatch[0].length).trim();
      if (afterFrame.length > 0) {
        // BIC-6 role-noun capture: "Our agents need X" → append "for agents" to subject.
        let roleNoun: string | null = null;
        const roleNounMatch = ROLE_NOUN_FROM_FRAME_PATTERN.exec(frameMatch[0].trim());
        if (roleNounMatch) {
          const noun = roleNounMatch[1]!.trim();
          const lastWord = noun.split(/\s+/).pop()!.toLowerCase();
          if (!GENERIC_ROLE_NOUNS.has(lastWord)) {
            roleNoun = noun;
          }
        }

        let resolved: string;
        if (WAY_TO_BRIDGE_PATTERN.test(afterFrame)) {
          // "a way to X" → "a system to X"
          resolved = "a system to " + afterFrame.replace(WAY_TO_BRIDGE_PATTERN, "").trim();
        } else if (INFINITIVE_COMPLEMENT_PATTERN.test(afterFrame)) {
          // BIC-6 infinitive: "to know when X" → "a system to know when X"
          resolved = "a system " + afterFrame;
        } else {
          resolved = afterFrame;
        }

        // Inject role noun when beneficiary must survive into the goal.
        if (roleNoun && !resolved.toLowerCase().includes(roleNoun.toLowerCase())) {
          resolved = resolved + " for " + roleNoun;
        }

        s = resolved;
        hasBusinessFrame = true;
      }
    } else {
      // BIC-6 bare proper-noun subject: "Sales needs X", "HR needs X"
      const propMatch = PROPER_NOUN_SUBJECT_FRAME_PATTERN.exec(s);
      if (propMatch) {
        const afterFrame = s.slice(propMatch[0].length).trim();
        if (afterFrame.length > 0) {
          s = WAY_TO_BRIDGE_PATTERN.test(afterFrame)
            ? "a system to " + afterFrame.replace(WAY_TO_BRIDGE_PATTERN, "").trim()
            : INFINITIVE_COMPLEMENT_PATTERN.test(afterFrame)
              ? "a system " + afterFrame
              : afterFrame;
          hasBusinessFrame = true;
        }
      }
    }
  }

  let leadVerb: string | null = null;

  // Step 3: Lead-verb extraction — skip when business frame already normalized.
  if (!hasBusinessFrame) {
    const first = firstToken(s);
    if (first) {
      const alpha = tokenAlpha(first.original);
      const isVerbCandidate =
        /^[a-zA-Z-]+$/.test(alpha) && !NON_VERB_OPENERS.has(first.lower);
      if (isVerbCandidate) {
        const rest = stripFirstToken(s);
        if (passesMinimumResidual(rest)) {
          leadVerb = first.original;
          s = rest;

          // BIC-7: "Set up" phrasal verb — when leadVerb is "Set" and the remaining
          // string begins with "up ", combine into "Set up" (atomic phrasal verb) and
          // advance past "up " so the deliverable noun phrase is the new subject.
          if (leadVerb.toLowerCase() === "set" && /^up\s+/i.test(s)) {
            leadVerb = "Set up";
            s = s.replace(/^up\s+/i, "").trim();
          }

          // Late business-delivery detection: after a PREAMBLE verb is stripped
          // (or "Set up" phrasal combine), if what remains is "a/an/the [noun] to
          // [purpose]", the purpose complement is part of the deliverable — preserve.
          if (ARTICLE_LED_DELIVERY_PATTERN.test(s)) {
            hasBusinessFrame = true;
          }
        }
      }
    }
  }

  // Step 4: Purpose-clause stripping — only for non-business inputs.
  // Business inputs must retain the purpose complement (the "to <verb>..."
  // clause that expresses the business reason) inside the goal text.
  if (!hasBusinessFrame) {
    const purposeCandidate = s.replace(PURPOSE_CLAUSE_PATTERN, "").trim();
    if (purposeCandidate !== s && passesMinimumResidual(purposeCandidate)) {
      s = purposeCandidate;
    }
  }

  const subject = s.trim();
  if (subject.length === 0) {
    return { subject: fallback, leadVerb: null, defaulted: true };
  }

  return { subject, leadVerb, defaulted: false };
}

function extractSubject(rawInput: string): string {
  return normalizeSubject(rawInput).subject;
}

function computePlanHash(
  deliverableType: string,
  goal: string,
  tasks: readonly WorkPlanTask[],
  nextAction: string,
): string {
  const payload = [
    deliverableType,
    goal,
    tasks.map(t => [
      t.action,
      t.target,
      t.operatorAction,
      `${t.sourceSpan.ref}:${t.sourceSpan.start}:${t.sourceSpan.end}`,
    ]),
    nextAction,
  ];
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isGrounded(
  goalText: string,
  classification: DeliverableClassification,
): boolean {
  if (classification.type === "planning") {
    return goalText.length > 0;
  }
  const entry = TYPE_PATTERNS.find(p => p.type === classification.type);
  return entry ? entry.pattern.test(goalText) : false;
}

/**
 * USESTEADY_ANALYSIS_SURFACE_IMPL_V1 — ratified S2: directive analysis asks become
 * specialized WorkPlans (deliverableType "analysis_findings"). Goal/terminal are
 * extractive from the ask's complement; the terminal commitment names findings —
 * never a built system. Analysis Completion Rule: recommendations are owed only
 * for figure_out_how asks.
 */
function buildAnalysisWorkPlan(
  ask: AnalysisAsk,
  sourceSpan: WorkPlanSourceRef,
): WorkPlan {
  const template = getTemplate("analysis_findings");
  const subject = ask.complement;

  const goal = ask.subtype === "figure_out_how"
    ? `Determine ${subject}`
    : `Produce an explanation of ${subject}`;
  const terminalOutcome = ask.subtype === "figure_out_how"
    ? `Findings and recommended approach documented: ${subject}`
    : `Findings documented: an evidence-backed answer to ${subject}`;

  const tasks: WorkPlanTask[] = template.phases.map((phase, idx) => ({
    id:             phase.id,
    action:         phase.action,
    target:         resolveTarget(phase.targetKey, subject),
    outcome:        resolveOutcome(phase.outcomeKey),
    operatorAction: phase.operatorAction,
    sourceSpan,
    status:         idx === 0 ? ("active" as const) : ("pending" as const),
    evidenceLevel:  "derived" as const,
    ...(idx > 0 ? { precondition: template.phases[idx - 1]!.id } : {}),
  }));

  const nextAction = tasks[0]!.id;
  const planHash = computePlanHash("analysis_findings", goal, tasks, nextAction);

  return {
    goal,
    sourceContractRef: "rawInput",
    tasks,
    nextAction,
    terminalOutcome,
    trustClass:      "pre_execution_review",
    deliverableType: "analysis_findings",
    planHash,
  };
}

/**
 * Generate a deterministic WorkPlan from confirmed understanding.
 * Every task is template-derived with a resolvable sourceSpan.
 */
export function generateWorkPlanFromConfirmed(
  confirmed: ConfirmedUnderstandingV1,
): WorkPlan {
  // USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1 (S2) — consuming invariant
  // (INV-GI-2): when a human-ratified goal exists, the ratified span is the ONLY
  // planning input. The analysis-ask check reads the ratified goal (not the blob)
  // for the same reason. With no ratified goal, everything below is byte-identical
  // to the legacy path (INV-GI-4 removal guarantee).
  const hasRatifiedGoal = confirmed.ratifiedGoal !== undefined;
  const operativeText = hasRatifiedGoal
    ? confirmed.ratifiedGoal!.text
    : confirmed.rawInput;

  // Directive analysis asks short-circuit to the analysis_findings specialized
  // WorkPlan before goal isolation — the investigation question IS the goal.
  const analysisAsk = parseAnalysisAsk(operativeText);
  if (analysisAsk !== null) {
    const analysisSpan: WorkPlanSourceRef = hasRatifiedGoal
      ? {
          ref:   "rawInput",
          start: confirmed.ratifiedGoal!.start,
          end:   confirmed.ratifiedGoal!.end,
        }
      : { ref: "rawInput", start: 0, end: confirmed.rawInput.length };
    return buildAnalysisWorkPlan(analysisAsk, analysisSpan);
  }

  const isolated = hasRatifiedGoal
    ? isolateIntentFromRatifiedGoal(confirmed)
    : isolateIntentFromConfirmed(confirmed);
  const classification = classifyDeliverableFromGoal(
    isolated.goalText,
    isolated.goalSourceRef,
  );
  if (!isGrounded(isolated.goalText, classification)) {
    throw new Error("work_plan_generation: contract does not ground deliverable type");
  }

  const template = getTemplate(classification.type);
  const { subject, leadVerb } = normalizeSubject(isolated.goalText);
  const goalVerb = leadVerb ? capitalizeFirst(leadVerb) : "Create";
  const goal = classification.type === "planning"
    ? template.goalPattern(subject, goalVerb)
    : template.goalPattern(subject);

  const tasks: WorkPlanTask[] = template.phases.map((phase, idx) => ({
    id:               phase.id,
    action:           phase.action,
    target:           resolveTarget(phase.targetKey, subject),
    outcome:          resolveOutcome(phase.outcomeKey),
    operatorAction:   phase.operatorAction,
    sourceSpan:       classification.sourceSpan,
    status:           idx === 0 ? "active" : "pending",
    evidenceLevel:    "derived" as const,
    ...(idx > 0 ? { precondition: template.phases[idx - 1]!.id } : {}),
  }));

  if (tasks.length === 0) {
    throw new Error("work_plan_generation: no admissible tasks");
  }

  const nextAction = tasks[0]!.id;
  const terminalOutcome = template.terminalOutcomePattern(subject);

  const planHash = computePlanHash(
    classification.type,
    goal,
    tasks,
    nextAction,
  );

  return {
    goal,
    sourceContractRef: "rawInput",
    tasks,
    nextAction,
    terminalOutcome,
    trustClass:      "pre_execution_review",
    deliverableType: classification.type,
    planHash,
  };
}

/** T6: structural hash equality across runs. */
export function assertPlanDeterminism(
  confirmed: ConfirmedUnderstandingV1,
  runs = 3,
): boolean {
  const hashes = new Set<string>();
  for (let i = 0; i < runs; i++) {
    hashes.add(generateWorkPlanFromConfirmed(confirmed).planHash);
  }
  return hashes.size === 1;
}

/** T3: verify template registry contains no forbidden PM actions. */
export function assertTemplatesForbiddenClean(): boolean {
  for (const template of Object.values(PHASE_TEMPLATES)) {
    for (const phase of template.phases) {
      const lower = phase.action.toLowerCase();
      for (const forbidden of FORBIDDEN_TEMPLATE_ACTIONS) {
        if (lower.includes(forbidden)) return false;
      }
    }
  }
  return true;
}

export { classifyDeliverableFromGoal as classifyDeliverable, computePlanHash, extractSubject };
export {
  isolateIntentFromConfirmed,
  isolateIntentFromRatifiedGoal,
  isGoalIsolationDeclinedError,
  GoalIsolationDeclinedError,
} from "./isolated-intent.js";
export type { IsolatedIntent, NonGoalSegment } from "./isolated-intent.js";
