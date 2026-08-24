/**
 * Goal isolation boundary — USESTEADY_WORKPLAN_ASK_SPAN_EXTRACTION_IMPL_V1
 *
 * Locates the operative ask span (imperative / labelled directive) and fences
 * status, evidence, history, quoted examples, and manifests. Fail-closed when
 * no ask span exists — never falls back to the residual blob.
 */
import { createHash } from "node:crypto";
export class GoalIsolationDeclinedError extends Error {
    code = "goal_isolation_declined";
    reason;
    constructor(reason) {
        super(`goal_isolation_declined: ${reason}`);
        this.name = "GoalIsolationDeclinedError";
        this.reason = reason;
    }
}
export function isGoalIsolationDeclinedError(err) {
    return err instanceof GoalIsolationDeclinedError;
}
const GOAL_SENTENCE_PATTERNS = [
    /^I want (?:to |a workflow that |an? )/i,
    /^I need to /i,
    /^We (?:need|want) to /i,
    /^Help me (?:to )?/i,
    /^Please (?:create|build|fix|improve|add|implement|prepare|run|document|configure|refactor|migrate|scaffold|backtest|investigate)\b/i,
];
const IMPERATIVE_VERBS = new Set([
    "authorize", "backtest", "build", "commit", "configure", "create", "document",
    "execute", "fix", "implement", "improve", "investigate", "merge", "open",
    "prepare", "proceed", "produce", "push", "refactor", "run", "scaffold", "start",
]);
/**
 * Operative-verb lexicon — USESTEADY_OPERATIVE_ASK_PREDICATE_IMPL_V1 (site 1 only).
 *
 * Superset of IMPERATIVE_VERBS with the ordinary operative verbs proven required by
 * USESTEADY_OPERATIVE_VERB_COVERAGE_CHARACTERIZATION_V1 (#831). Used ONLY by
 * extractOperativeAsk at the bare-imperative candidate-admission site. It does NOT replace
 * IMPERATIVE_VERBS, which still governs the labelled/section paths (extractSectionAsk) and
 * isStatusProse.
 *
 * Scope note: this lane shipped the #831 completeness widening (site 1) ONLY. The #832
 * soundness narrowing (single-line fallback) was deferred — implementation falsified the
 * #833 claim that one positive predicate handles both. Accordingly the lexicon is the
 * principled #831 operative set; hostile-capable verbs that only existed to document the
 * deferred site-2 exception are intentionally NOT included.
 */
const OPERATIVE_VERBS = new Set([
    ...IMPERATIVE_VERBS,
    "migrate", "determine", "identify", "update", "delete", "remove", "add", "set",
    "replace", "introduce", "design", "review", "audit", "verify", "validate",
    "optimize", "deploy", "rename", "move", "enable", "ensure", "analyze", "generate",
    "modify", "install", "integrate", "summarize", "translate", "monitor", "resolve",
    "restore", "revert", "rewrite", "schedule", "sync", "test", "transform", "upgrade",
    "write", "check", "draft", "establish", "evaluate", "extend", "extract", "normalize",
    "parse", "patch", "plan", "provision", "publish", "purge", "reduce", "rollback",
    "setup", "split", "disable", "connect", "apply", "insert",
]);
// Question-opening words. A line that opens with one of these and ends with "?" is
// interrogative (not an operative ask).
const WH_AUX = /^(?:why|what|when|where|who|how|which|should|could|would|can|is|are|am|do|does|did|will|shall|may|might)\b/i;
function isInterrogative(text) {
    const t = text.trim();
    return /\?\s*$/.test(t) && WH_AUX.test(t);
}
const GENERIC_REFLECTION_BULLETS = new Set([
    "request received",
    "confirm understanding",
]);
const LABELLED_ASK_PATTERNS = [
    /^Objective:\s*(.+)/is,
    /^Goal:\s*(.+)/is,
    /^OPEN\s+(USESTEADY[\w_]+(?:\s+.+)?)/is,
    /^Open:\s*(USESTEADY[\w_]+(?:\s+.+)?)/is,
    /^Next Opus Contract:\s*(USESTEADY[\w_]+(?:\s+.+)?)/is,
    /^Task:\s*(.+)/is,
    /^Composer instruction:\s*(.+)/is,
];
const SECTION_ASK_HEADERS = /^(?:Next:|Recommended Next Actions:|What I would do next|CTO call:|Decision Needed From You:)\s*(.*)$/is;
function isGoalSentence(text) {
    const trimmed = text.trim();
    return trimmed.length > 0 && GOAL_SENTENCE_PATTERNS.some(p => p.test(trimmed));
}
function firstToken(s) {
    const match = /^\s*(\S+)/.exec(s);
    if (!match)
        return null;
    const original = match[1];
    const alpha = original.replace(/[^a-zA-Z-]/g, "");
    if (alpha.length === 0)
        return null;
    return { original, lower: alpha.toLowerCase() };
}
function stripAnswerPrefix(text) {
    return text
        .replace(/^(?:Yes|Authorized|Agreed|Good|Excellent|Locked|Use MCP)\s*[-—.!:\s]+/i, "")
        .trim();
}
function trimStagingManifest(text) {
    let line = text.trim();
    const stageIdx = line.search(/\bStage only:/i);
    if (stageIdx > 0)
        line = line.slice(0, stageIdx).trim();
    const dashIdx = line.search(/\n-\s+(?:src|docs|tests|scripts|ui)\//);
    if (dashIdx > 0)
        line = line.slice(0, dashIdx).trim();
    return line;
}
function trimLabelledContent(text) {
    const firstSection = text.split(/\n(?:Questions:|Required deliverables:|Scope:|Method:|In Scope|Out of Scope)/i)[0];
    const firstParagraph = firstSection.split(/\n\n+/)[0];
    return firstParagraph.trim();
}
function extractLabelledAsk(text) {
    const trimmed = text.trim();
    for (const pattern of LABELLED_ASK_PATTERNS) {
        const match = pattern.exec(trimmed);
        if (match?.[1])
            return trimLabelledContent(match[1].trim());
        if (match?.[0])
            return trimLabelledContent(match[0].trim());
    }
    if (/^OPEN\s+USESTEADY/i.test(trimmed))
        return trimmed;
    if (/^Open:\s*USESTEADY/i.test(trimmed))
        return trimLabelledContent(trimmed.replace(/^Open:\s*/i, "").trim());
    return null;
}
function extractImperativeAsk(text) {
    let line = trimStagingManifest(stripAnswerPrefix(text));
    if (line.length === 0)
        return null;
    if (/^Stage only:/i.test(line))
        return null;
    const first = firstToken(line);
    if (first && IMPERATIVE_VERBS.has(first.lower)) {
        return line.replace(/[.!]+$/, "").trim();
    }
    if (/^(?:push\s*\+\s*)?open\s+(?:PR|a\s+)/i.test(line))
        return line.trim();
    if (/^Proceed with /i.test(line))
        return line.trim();
    if (/^Run the prompt above now/i.test(line))
        return line.trim();
    return null;
}
/**
 * Positive operative-ask extraction — USESTEADY_OPERATIVE_ASK_PREDICATE_IMPL_V1.
 *
 * Like extractImperativeAsk, but gates on the wider OPERATIVE_VERBS lexicon and rejects
 * interrogatives. This is the extraction half of the operative-ask predicate used at the
 * two admission sites. It does NOT change extractImperativeAsk (still closed-whitelist for
 * the labelled/section/status paths).
 */
function extractOperativeAsk(text) {
    const line = trimStagingManifest(stripAnswerPrefix(text));
    if (line.length === 0)
        return null;
    if (/^Stage only:/i.test(line))
        return null;
    if (isInterrogative(line))
        return null;
    const first = firstToken(line);
    if (first && OPERATIVE_VERBS.has(first.lower)) {
        return line.replace(/[.!]+$/, "").trim();
    }
    if (/^(?:push\s*\+\s*)?open\s+(?:PR|a\s+)/i.test(line))
        return line.trim();
    if (/^Proceed with /i.test(line))
        return line.trim();
    if (/^Run the prompt above now/i.test(line))
        return line.trim();
    return null;
}
/**
 * Sentence segmentation - USESTEADY_MIXED_PARAGRAPH_CLAUSE_SCOPING_IMPL_V1 (M3).
 *
 * Deterministic boundary only: terminal punctuation (. ! ?) followed by whitespace
 * and a capital/opening-paren start. Commas are deliberately NOT a boundary - comma
 * clause scoping is a semantic-judgment problem (object lists vs. trailing filler are
 * lexically identical), which belongs to the M1 semantic-ambiguity axis, not the
 * deterministic M3 parser refinement.
 */
function splitSentences(text) {
    return text
        .split(/(?<=[.!?])\s+(?=[A-Z(])/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}
function extractSectionAsk(text) {
    const match = SECTION_ASK_HEADERS.exec(text.trim());
    if (!match)
        return null;
    const tail = (match[1] ?? "").trim();
    if (tail.length >= 8) {
        return extractImperativeAsk(tail) ?? tail;
    }
    return null;
}
function isEvidenceBlock(text) {
    const t = text.trim();
    if (/^<[^>]+>/.test(t) || /<\/?(?:title|meta|html|body|div|span|script|style)\b/i.test(t)) {
        return true;
    }
    if (/^(?:ERROR|WARN|INFO|Traceback|Exception|Stack trace)/i.test(t))
        return true;
    if (/\bat\s+\S+\([^)]*\)/.test(t))
        return true;
    if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(t))
        return true;
    if (/^(?:---|\*\*\*|===)/.test(t))
        return true;
    return false;
}
function isContextBlock(text) {
    return /^(?:I (?:copied|pasted|attached|shared|found)|Here is (?:our|the|my|a)|Below is|Attached (?:is|are)|For context)/i.test(text.trim());
}
function isInstructionBlock(text) {
    const t = text.trim();
    return (/^(?:Explain your understanding|Ask questions before|Do not generate|Don't generate|Before acting|Do not (?:implement|execute|change))/i.test(t) ||
        /\bbefore (?:acting|you act|implementation)\b/i.test(t));
}
function isExampleBlock(text) {
    return /^(?:Here is an example|For example:|Example workflow:|Sample implementation:|Example:|Input:)/i.test(text.trim());
}
function isConstraintBlock(text) {
    return /^(?:Do not|Don't|Must not|Without changing|No (?:runtime|governance|execution|portal))/i.test(text.trim());
}
function isStatusProse(text) {
    const t = text.trim();
    if (/^(?:Current Reality|Current portfolio|Layer Status|Lane Status|Program Status|Executive Summary|What Was Delivered|What is now proven|What is notable)/i.test(t)) {
        return true;
    }
    if (/^#\s+P\d+/i.test(t))
        return true;
    if (/^(?:Date Closed|Founder Approval|Status:\s*\*\*)/i.test(t))
        return true;
    if (/^(?:This is ready for review\/merge|This is good enough|This is actually a useful result|This is now one of the cleanest|Agreed\. At this point)/i.test(t)) {
        return true;
    }
    if (/^(?:✅|Mechanical cert|WorkPlan generator|Understanding Truth|Runtime Truth)/i.test(t) && !extractImperativeAsk(t)) {
        return true;
    }
    if (/\bPASS\b|\bFAIL\b|\bMERGED\b|\bCOMPLETE\b/i.test(t) && !extractImperativeAsk(t) && !extractLabelledAsk(t)) {
        if (/Layer|Status|cert|regression|fixture/i.test(t))
            return true;
    }
    return false;
}
function isManifestLine(text) {
    return /^-\s+(?:src|docs|tests|scripts|ui)\//.test(text.trim());
}
function isQuotedExampleLine(text, hasStrongerAsk) {
    return hasStrongerAsk && isGoalSentence(text);
}
function classifyNonAskBlock(text) {
    if (isEvidenceBlock(text))
        return "evidence";
    if (isContextBlock(text))
        return "context";
    if (isInstructionBlock(text))
        return "instruction";
    if (isExampleBlock(text))
        return "example";
    if (isConstraintBlock(text))
        return "constraint";
    if (isStatusProse(text))
        return "context";
    if (isManifestLine(text))
        return "instruction";
    return "unknown";
}
function splitRawInputBlocks(rawInput) {
    const blocks = [];
    const lines = rawInput.split("\n");
    let offset = 0;
    // Paragraph-break preservation (USESTEADY_ASK_SPAN_TERMINATION_IMPL_V1):
    // empty lines are dropped, so record whether one or more blank lines preceded
    // a block. The labelled-span terminator uses this as a hard boundary.
    let sawBlank = false;
    for (const line of lines) {
        const lineStart = offset;
        const trimmed = line.trim();
        offset += line.length + 1;
        if (trimmed.length === 0) {
            sawBlank = true;
            continue;
        }
        blocks.push({
            text: trimmed,
            start: lineStart + line.indexOf(trimmed),
            end: lineStart + line.indexOf(trimmed) + trimmed.length,
            ...(sawBlank ? { blankBefore: true } : {}),
        });
        sawBlank = false;
    }
    if (blocks.length === 0 && rawInput.trim().length > 0) {
        const trimmed = rawInput.trim();
        blocks.push({ text: trimmed, start: 0, end: trimmed.length });
    }
    return blocks;
}
/**
 * Labelled-span terminator support — USESTEADY_ASK_SPAN_TERMINATION_IMPL_V1.
 *
 * An "Objective:" / "Goal:" label on its own line opens a span that previously
 * ran past the operative clause into the next section (Current:, Deliverables,
 * Recommended Next Actions, ...), flow diagrams, or following paragraphs.
 * The span now terminates at the first real boundary: a section header, a
 * paragraph break (blankBefore), or a flow/diagram line.
 */
const LABEL_SPAN_MAX = 240;
const SECTION_NAMES = [
    // pre-existing terminators
    "Example", "Input", "Hard scope", "Contract name", "Objective", "Goal",
    "Bad current output", "Target output", "Questions", "Q\\d+", "Next Opus Contract",
    // observed operator-contract section headers (this lane)
    "Current", "Target", "Deliverables", "Acceptance", "Recommended Next Actions",
    "In Scope", "Out of Scope", "Problem Statement", "Scope", "Method",
    "Success Criteria", "Required Behavior", "Required Tests", "Required deliverables",
    "Risks", "Risks & Limitations", "Decision", "Decision Needed From You",
    "Path to Commercial",
].join("|");
// A line that introduces a new section: "<name>:" (with or without trailing
// content) OR a bare "<name>" line. Anchored so operative prose that merely
// begins with one of these words ("Scope the project") is not matched.
const SECTION_BOUNDARY = new RegExp(`^(?:${SECTION_NAMES}):|^(?:${SECTION_NAMES})\\s*:?\\s*$`, "i");
// A pure flow/diagram connector line: only arrows / dashes / whitespace, with at
// least one arrow. "→ IsolatedIntent" (arrow + content) is NOT a flow line.
const FLOW_LINE = /^(?:\s*(?:[\u2190-\u21FF]|-+>|=+>|<-+)\s*)+$/;
function isLabelSpanBoundary(block) {
    if (block.blankBefore)
        return true;
    const t = block.text.trim();
    return SECTION_BOUNDARY.test(t) || FLOW_LINE.test(t);
}
/**
 * Illustrative-imperative candidate admission filter —
 * USESTEADY_ILLUSTRATIVE_IMPERATIVE_SELECTION_IMPL_V1.
 *
 * An imperative-shaped line ("Open ...") is admitted as an ask candidate purely
 * because its first token is an imperative verb. Two structural cases are NOT
 * operative requests and must be withheld from the candidate pool (so a memo
 * with no real ask fails closed instead of selecting an example):
 *
 *  1. Flow-diagram node — a line that is a node inside a diagram, i.e. it is
 *     immediately adjacent (no paragraph break between) to a pure flow/arrow
 *     connector line. D5's "Open Pega/Temporal/ServiceNow integration" lines sit
 *     between down-arrows under "The failure mode would have been:".
 *  2. Open/Closed Questions section header — part-of-speech ambiguity where the
 *     first word reads as an adjective, not a verb ("Open Questions" is a header,
 *     not "open [the] questions").
 *
 * Scope: candidate admission only. No ranking, termination, normalization,
 * classifier, or WorkPlan behavior is touched.
 */
const QUESTIONS_HEADER = /^(?:Open|Closed)\s+Questions$/i;
function isIllustrativeImperative(block, blocks, index) {
    if (QUESTIONS_HEADER.test(block.text.trim()))
        return true;
    const prev = blocks[index - 1];
    const next = blocks[index + 1];
    const prevIsAdjacentFlow = !block.blankBefore && prev !== undefined && FLOW_LINE.test(prev.text.trim());
    const nextIsAdjacentFlow = next !== undefined && !next.blankBefore && FLOW_LINE.test(next.text.trim());
    return prevIsAdjacentFlow || nextIsAdjacentFlow;
}
function expandLabelledBlocks(blocks) {
    const expanded = [];
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (/^Open:\s*$/i.test(block.text.trim())) {
            const next = blocks[i + 1];
            if (next && /^USESTEADY/i.test(next.text.trim())) {
                expanded.push({
                    text: `Open: ${next.text.trim()}`,
                    start: block.start,
                    end: next.end,
                });
                i += 1;
                continue;
            }
        }
        if (/^Next Opus Contract$/i.test(block.text.trim())) {
            const next = blocks[i + 1];
            if (next && /^USESTEADY/i.test(next.text.trim())) {
                expanded.push({
                    text: `Open: ${next.text.trim()}`,
                    start: block.start,
                    end: next.end,
                });
                i += 1;
                continue;
            }
        }
        if (/^USESTEADY[\w_]+$/i.test(block.text.trim()) && i > 0) {
            const prev = blocks[i - 1];
            if (/^(?:Open|Next Opus Contract|Contract name):?$/i.test(prev.text.trim())) {
                continue;
            }
        }
        // Objective/Goal labelled span (bare or colon, alone on a line). Expand into
        // one block, terminating at the first real boundary (section header,
        // paragraph break, or flow line). USESTEADY_ASK_SPAN_TERMINATION_IMPL_V1 —
        // single terminator + single cap reconcile the prior bare(240)/colon(uncapped)
        // mismatch.
        if (/^(?:Objective|Goal):?\s*$/i.test(block.text.trim())) {
            const parts = [];
            let end = block.end;
            let j = i + 1;
            while (j < blocks.length) {
                const next = blocks[j];
                if (isLabelSpanBoundary(next))
                    break;
                parts.push(next.text);
                end = next.end;
                j++;
                if (parts.join(" ").length > LABEL_SPAN_MAX)
                    break;
            }
            if (parts.length > 0) {
                expanded.push({
                    text: `Objective: ${parts.join(" ")}`,
                    start: block.start,
                    end,
                });
                i = j - 1;
                continue;
            }
        }
        expanded.push(block);
    }
    return expanded;
}
function collectAskCandidates(blocks) {
    const candidates = [];
    const hasLabelledElsewhere = blocks.some(b => extractLabelledAsk(b.text) !== null);
    const hasSectionElsewhere = blocks.some(b => extractSectionAsk(b.text) !== null);
    const hasStrongerAsk = hasLabelledElsewhere || hasSectionElsewhere;
    let inExampleSection = false;
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (/^(?:Example|Input|Bad current output|Target output):?\s*$/i.test(block.text.trim())) {
            inExampleSection = true;
            continue;
        }
        if (/^Hard scope:/i.test(block.text.trim())) {
            inExampleSection = false;
        }
        if (inExampleSection)
            continue;
        const labelled = extractLabelledAsk(block.text);
        if (labelled) {
            const priority = /^Open:\s*USESTEADY|^OPEN\s+USESTEADY/i.test(block.text) ? 35 : 30;
            candidates.push({
                text: labelled,
                start: block.start,
                end: block.end,
                priority,
                index: i,
            });
            continue;
        }
        const section = extractSectionAsk(block.text);
        if (section) {
            candidates.push({
                text: section,
                start: block.start,
                end: block.end,
                priority: 25,
                index: i,
            });
            continue;
        }
        if (isStatusProse(block.text) || isManifestLine(block.text))
            continue;
        // USESTEADY_OPERATIVE_ASK_PREDICATE_IMPL_V1 (site 1) — admit on the wider
        // operative-ask predicate (was the closed IMPERATIVE_VERBS whitelist). The #829
        // structural suppression below remains IN FRONT: admit iff NOT structurally
        // suppressed AND operative. The predicate is necessary, not sufficient.
        const imperative = extractOperativeAsk(block.text);
        if (imperative) {
            // USESTEADY_ILLUSTRATIVE_IMPERATIVE_SELECTION_IMPL_V1 — withhold
            // imperative-shaped lines that are illustrative (diagram nodes) or
            // section headers ("Open Questions"); they are not operative requests.
            if (!isIllustrativeImperative(block, blocks, i)) {
                // USESTEADY_MIXED_PARAGRAPH_CLAUSE_SCOPING_IMPL_V1 (M3) - scope a leading
                // operative line to its first sentence; any trailing sentences are filler
                // co-occurring on the same line. Pure text shortening: the candidate's
                // block/priority/index are unchanged, so this cannot alter WHICH candidate
                // is selected - only how far the selected operative clause extends.
                const sentences = splitSentences(imperative);
                const scoped = sentences.length > 1
                    ? (extractOperativeAsk(sentences[0]) ?? imperative)
                    : imperative;
                candidates.push({
                    text: scoped,
                    start: block.start,
                    end: block.end,
                    priority: 20,
                    index: i,
                });
            }
            continue;
        }
        if (isGoalSentence(block.text) && !hasStrongerAsk) {
            candidates.push({
                text: block.text.trim(),
                start: block.start,
                end: block.end,
                priority: 10,
                index: i,
            });
        }
    }
    return candidates;
}
function selectAskSpan(blocks) {
    const candidates = collectAskCandidates(blocks);
    if (candidates.length > 0) {
        candidates.sort((a, b) => {
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            // Same priority: prefer earliest imperative/labelled on line 0–1, else tail wins.
            if (a.priority >= 20 && a.index <= 1 && b.index > 1)
                return -1;
            if (b.priority >= 20 && b.index <= 1 && a.index > 1)
                return 1;
            return b.index - a.index;
        });
        const best = candidates[0];
        return { text: best.text.trim(), start: best.start, end: best.end };
    }
    // Single-line clean intent (Type A / synthetic fixtures) — not a multi-line blob fallback.
    //
    // USESTEADY_OPERATIVE_ASK_PREDICATE_IMPL_V1 deliberately does NOT narrow this fallback
    // (site 2 deferred). Implementation falsified the #833 design claim: a positive
    // operative-ask predicate cannot separate the certified describe-path (SESSION-001)
    // declarative ("AI helps understand and plan work …") from #832 vague-filler ("so um the
    // thing is kind of not working …") — both are declarative and lexically identical at this
    // boundary. The #832 fix is a soundness problem, not an admission-predicate problem; it is
    // handed to USESTEADY_DESCRIBE_PATH_VS_VAGUE_FILLER_CHARACTERIZATION_V1.
    if (blocks.length === 1) {
        const only = blocks[0];
        // USESTEADY_MIXED_PARAGRAPH_CLAUSE_SCOPING_IMPL_V1 (M3) - re-scope an operative
        // clause out of a single-block mixed paragraph whose LEADING sentence is filler
        // (e.g. "Things have been hectic lately. Migrate the billing service.").
        // Strictly bounded: fires ONLY when an operative sentence EXISTS. If none exists,
        // control falls through to the UNCHANGED fallback below - the #832 / describe-path
        // soundness boundary stays frozen. This re-scopes an already-admitted clause; it
        // never widens admission (a no-ask paragraph is admitted/declined exactly as before).
        const sentences = splitSentences(only.text);
        if (sentences.length > 1) {
            for (const s of sentences) {
                const op = extractOperativeAsk(s);
                if (op) {
                    return { text: op, start: only.start, end: only.end };
                }
            }
        }
        if (classifyNonAskBlock(only.text) === "unknown" && !isStatusProse(only.text)) {
            return { text: only.text.trim(), start: only.start, end: only.end };
        }
    }
    return null;
}
function isNoGoalMessage(rawInput, blocks) {
    if (/Closure Record/i.test(rawInput) &&
        /(?:officially closed|Status:\s*\*\*COMPLETE|Status:\*\*\s*COMPLETE)/i.test(rawInput)) {
        return collectAskCandidates(blocks).length === 0;
    }
    if (/Decision:\s*approve\/merge\s+#\d+/i.test(rawInput)) {
        const asks = collectAskCandidates(blocks);
        const buildable = asks.some(a => /\b(?:implement|build|create|open|run|commit|authorize)\b/i.test(a.text));
        if (!buildable)
            return true;
    }
    return false;
}
function classifyBulletKind(bullet) {
    const trimmed = bullet.trim();
    if (GENERIC_REFLECTION_BULLETS.has(trimmed.toLowerCase()))
        return "context";
    const kind = classifyNonAskBlock(trimmed);
    if (kind === "unknown") {
        if (isEvidenceBlock(trimmed))
            return "evidence";
        if (isGoalSentence(trimmed))
            return "example";
        return "context";
    }
    return kind;
}
function segmentFromBullet(bullet, index) {
    const trimmed = bullet.trim();
    return {
        kind: classifyBulletKind(trimmed),
        text: trimmed,
        sourceRef: `bullet:${index}`,
        start: 0,
        end: trimmed.length,
    };
}
function segmentFromBlock(kind, text, start, end) {
    return { kind, text, sourceRef: "rawInput", start, end };
}
function computeIsolationHash(goalText, segments) {
    const payload = {
        goalText,
        segments: segments.map(s => [s.kind, s.text, s.sourceRef, s.start, s.end]),
    };
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
function blockIsSelectedAsk(block, askPick) {
    return block.start === askPick.start && block.end === askPick.end;
}
/**
 * Isolate operative ask text from confirmed understanding.
 * Bullets never contribute to goalText — they are non-goal traceability only.
 */
export function isolateIntentFromConfirmed(confirmed) {
    const rawInput = confirmed.rawInput.trim();
    const blocks = expandLabelledBlocks(splitRawInputBlocks(rawInput));
    if (isNoGoalMessage(rawInput, blocks)) {
        throw new GoalIsolationDeclinedError("no operative ask in message");
    }
    const askPick = selectAskSpan(blocks);
    if (!askPick || askPick.text.trim().length === 0) {
        throw new GoalIsolationDeclinedError("no operative ask span found");
    }
    const nonGoalSegments = [];
    const hasLabelledElsewhere = blocks.some(b => extractLabelledAsk(b.text) !== null);
    const hasSectionElsewhere = blocks.some(b => extractSectionAsk(b.text) !== null);
    const hasStrongerAsk = hasLabelledElsewhere || hasSectionElsewhere;
    for (const block of blocks) {
        if (blockIsSelectedAsk(block, askPick))
            continue;
        if (isQuotedExampleLine(block.text, hasStrongerAsk)) {
            nonGoalSegments.push(segmentFromBlock("example", block.text, block.start, block.end));
            continue;
        }
        const kind = classifyNonAskBlock(block.text);
        if (kind !== "unknown") {
            nonGoalSegments.push(segmentFromBlock(kind, block.text, block.start, block.end));
        }
        else if (isGoalSentence(block.text)) {
            nonGoalSegments.push(segmentFromBlock("example", block.text, block.start, block.end));
        }
        else {
            nonGoalSegments.push(segmentFromBlock("context", block.text, block.start, block.end));
        }
    }
    for (let i = 0; i < confirmed.bullets.length; i++) {
        const bullet = confirmed.bullets[i].trim();
        if (bullet.length === 0)
            continue;
        nonGoalSegments.push(segmentFromBullet(bullet, i));
    }
    const goalSourceRef = {
        ref: "rawInput",
        start: askPick.start,
        end: askPick.end,
    };
    return {
        format: "usesteady.isolated-intent.v1",
        goalText: askPick.text.trim(),
        goalSourceRef,
        nonGoalSegments,
        isolationHash: computeIsolationHash(askPick.text.trim(), nonGoalSegments),
    };
}
/**
 * Ratified-goal isolation — USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1 (S2).
 *
 * When a human has ratified an isolated goal (charter §1: the model-proposed
 * IsolatedIntent candidate promoted by the explicit human yes), the ratified
 * span IS the goal — no ask-span heuristics run. This function is pure and
 * model-free (INV-GI-1): the ratified goal arrives as frozen text, so identical
 * ratified input → identical isolation → byte-identical plan.
 *
 * The remainder of the raw input is classified into non-goal segments with the
 * SAME deterministic block classifiers as the legacy path, so provenance and
 * display coverage survive (report §7.2 total-coverage) — but per INV-GI-2 the
 * caller reads ONLY goalText for classification, normalization, and planning.
 *
 * Fail-closed to legacy (INV-GI-4): a ratified goal that does not verify as a
 * verbatim substring of rawInput at its offsets throws — the generator catches
 * nothing here; verification happens at parse time (parseRatifiedGoalV1), so a
 * mismatch reaching this function is a programming error, not user input.
 */
export function isolateIntentFromRatifiedGoal(confirmed) {
    const ratified = confirmed.ratifiedGoal;
    if (!ratified) {
        throw new GoalIsolationDeclinedError("no ratified goal present");
    }
    const rawInput = confirmed.rawInput.trim();
    if (rawInput.slice(ratified.start, ratified.end) !== ratified.text) {
        throw new GoalIsolationDeclinedError("ratified goal is not a verbatim span of rawInput");
    }
    const goalText = ratified.text.trim();
    if (goalText.length === 0) {
        throw new GoalIsolationDeclinedError("ratified goal is empty");
    }
    const nonGoalSegments = [];
    for (const block of splitRawInputBlocks(rawInput)) {
        // Skip any block intersecting the ratified span — the goal owns it.
        if (block.start < ratified.end && block.end > ratified.start)
            continue;
        const kind = classifyNonAskBlock(block.text);
        if (kind !== "unknown") {
            nonGoalSegments.push(segmentFromBlock(kind, block.text, block.start, block.end));
        }
        else if (isGoalSentence(block.text)) {
            nonGoalSegments.push(segmentFromBlock("example", block.text, block.start, block.end));
        }
        else {
            nonGoalSegments.push(segmentFromBlock("context", block.text, block.start, block.end));
        }
    }
    for (let i = 0; i < confirmed.bullets.length; i++) {
        const bullet = confirmed.bullets[i].trim();
        if (bullet.length === 0)
            continue;
        nonGoalSegments.push(segmentFromBullet(bullet, i));
    }
    return {
        format: "usesteady.isolated-intent.v1",
        goalText,
        goalSourceRef: { ref: "rawInput", start: ratified.start, end: ratified.end },
        nonGoalSegments,
        isolationHash: computeIsolationHash(goalText, nonGoalSegments),
    };
}
/** GI-5 / AS-5: identical input → identical isolationHash across runs. */
export function assertIsolationDeterminism(confirmed, runs = 3) {
    const hashes = new Set();
    for (let i = 0; i < runs; i++) {
        hashes.add(isolateIntentFromConfirmed(confirmed).isolationHash);
    }
    return hashes.size === 1;
}
//# sourceMappingURL=isolated-intent.js.map