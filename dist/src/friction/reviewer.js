// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/reviewer.ts
 *
 * AI-powered friction report classifier.
 *
 * Calls Claude claude-haiku-4-5 (cheap, fast) with a structured prompt to decide
 * whether a submitted friction report represents genuine user friction worth
 * paying out, or should be rejected (spam, nonsense, gaming the system).
 *
 * Uses the Anthropic Messages API directly via fetch — no SDK dependency.
 * Requires ANTHROPIC_API_KEY in the environment.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseIssueContext, parseIssueMetadata } from "./github-issues.js";
import { hashObject } from "../ucp/hashes.js";
import { SYSTEM_STRUCTURAL_DERIVATION_V1, } from "../evidence-basis/types.js";
/**
 * Load ANTHROPIC_API_KEY from multiple locations in priority order:
 *  1. process.env (already set by caller / CI)
 *  2. ~/.usesteady/.env  (ops-specific, never committed)
 *  3. <cwd>/.env.local
 */
export function loadAnthropicKey() {
    if (process.env["ANTHROPIC_API_KEY"])
        return process.env["ANTHROPIC_API_KEY"];
    const candidates = [
        join(homedir(), ".usesteady", ".env"),
        join(process.cwd(), ".env.local"),
        join(process.cwd(), ".env"),
    ];
    for (const path of candidates) {
        if (!existsSync(path))
            continue;
        const lines = readFileSync(path, "utf-8").split("\n");
        for (const line of lines) {
            const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+)\s*$/);
            if (m?.[1])
                return m[1].trim().replace(/^["']|["']$/g, "");
        }
    }
    return undefined;
}
// ─── Prompt ───────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `\
You are a senior UX reviewer for UseSteady, a developer workflow tool.
Your job is to evaluate user-submitted "friction reports" and decide whether
each one represents genuine user friction that Shortgigs LLC should pay out.

UseSteady is a CLI/UI tool that lets developers run governed, step-by-step
code changes. Users submit a natural-language task (e.g. "rename Button.tsx
to PrimaryButton.tsx"), review it before it runs, and approve each step.

The intake system rejects tasks it cannot parse into a supported operation.
Supported operations are things like: mkdir, create file, rename file, move
file, delete file, run script. Intentionally vague or multi-scope instructions
like "fix everything" or "refactor the app" are correctly rejected.

APPROVAL CRITERIA (pay the reporter):
- The task input is something a reasonable developer would type, expecting it
  to work (e.g. "update the README", "add a test for login", "fix the linter")
- The error feedback the user received was unclear or didn't tell them what to
  do instead
- The friction was real — the user genuinely didn't know how to proceed
- Auto-captured failures (kind: workflow-failure) are approved if the task
  input is natural and the failure note shows skipped_by_intake

REJECTION CRITERIA (do not pay):
- The task input is obviously nonsensical, a test string, or intentionally
  designed to trigger an error (e.g. "aaa", "test", "do the thing", "???")
- The reporter is clearly gaming the system (submitting the same failure
  repeatedly with trivially invalid inputs)
- The kind is "server-error" and the error is an infrastructure problem,
  not a UX friction point
- The issue looks like a duplicate of another already-approved issue in the
  same session (same runId prefix)

SKIP (needs human review):
- Ambiguous cases where you are less than 60% confident
- Reports where the context is missing or truncated

Respond ONLY with a JSON object (no markdown fences), structured like:
{
  "decision": "approved" | "rejected" | "skip",
  "reason": "one or two sentence explanation",
  "confidence": 0-100
}`;
/**
 * Strip prompt-injection patterns from reporter-controlled strings before
 * they are included in the Claude user message.  We remove sequences that
 * attempt to address the system/assistant role or escape the data boundary.
 *
 * Returns the sanitized text plus a `bounded` flag: true when the field was
 * length-cut OR any elision pattern fired (the classifier saw a strict subset
 * of the reporter's content). The flag feeds the P4 evidence-basis record —
 * a verdict on a bounded field is a judgment on a partial extract.
 */
function sanitizeField(raw, maxLen = 300) {
    if (!raw)
        return { text: "(none)", bounded: false };
    const lengthCut = raw.length > maxLen;
    let elided = false;
    const text = raw
        .slice(0, maxLen)
        // Remove instruction-like role markers that could hijack the model.
        .replace(/\b(ignore|disregard|forget)\b.{0,60}(instruction|above|prior|previous|system|prompt)/gi, () => { elided = true; return "[redacted]"; })
        .replace(/<\/?(?:system|assistant|user|instruction)>/gi, () => { elided = true; return "[redacted]"; })
        // Strip markdown code fences that might be used to smuggle structured output.
        .replace(/```[\s\S]*?```/g, () => { elided = true; return "[code-block]"; })
        .trim();
    return { text, bounded: lengthCut || elided };
}
function buildUserMessage(issue) {
    const ctx = parseIssueContext(issue.body);
    const meta = parseIssueMetadata(issue.body);
    const truncated = new Set();
    // All reporter-controlled fields are sanitized before inclusion.
    const inputParts = (ctx.taskInputs ?? []).map(t => sanitizeField(t, 200));
    if (inputParts.some(p => p.bounded))
        truncated.add("task_inputs");
    const taskInputs = inputParts.map(p => p.text).join("; ") || "(none)";
    const failureNote = sanitizeField(ctx.failureNote);
    if (failureNote.bounded)
        truncated.add("failure_note");
    const notesField = ctx.notes ? sanitizeField(ctx.notes) : null;
    if (notesField?.bounded)
        truncated.add("reporter_notes");
    const notes = notesField ? `Reporter notes: ${notesField.text}` : "";
    const kind = sanitizeField(ctx.kind ?? meta?.["kind"], 50);
    if (kind.bounded)
        truncated.add("kind");
    const phase = sanitizeField(ctx.phase, 50);
    if (phase.bounded)
        truncated.add("phase");
    // Issue title is reporter-controlled too (used as the friction "headline").
    const title = sanitizeField(issue.title, 200);
    if (title.bounded)
        truncated.add("title");
    return {
        message: [
            `Issue #${issue.number}: ${title.text}`,
            ``,
            `Kind: ${kind.text}`,
            `Phase: ${phase.text}`,
            `Task inputs: ${taskInputs}`,
            `Failure note: ${failureNote.text}`,
            notes,
            `Reporter: @${issue.user.login}`,
            `Captured: ${meta?.["capturedAt"] ?? issue.created_at}`,
            `UseSteady version: ${meta?.["usesteadyVersion"] ?? "unknown"}`,
        ].filter(Boolean).join("\n"),
        truncatedFields: [...truncated],
        hasTaskInputs: (ctx.taskInputs ?? []).length > 0,
        hasFailureNote: typeof ctx.failureNote === "string" && ctx.failureNote.trim().length > 0,
        hasNotes: typeof ctx.notes === "string" && ctx.notes.trim().length > 0,
    };
}
// ─── P4: evidence-basis derivation (system-side, never from model prose) ─────
/**
 * Sources the reviewer NEVER sees — recorded as not_provided on every verdict
 * so a rejection can never be misread as "contradicted by all evidence".
 */
const NEVER_SUPPLIED_SOURCES = [
    {
        source: "issue_attachments_media",
        availability: "not_provided",
        detail: "Attachments, images, and other media on the issue were never fetched or supplied.",
    },
    {
        source: "comment_thread",
        availability: "not_provided",
        detail: "The issue comment thread was never fetched or supplied.",
    },
    {
        source: "full_issue_body",
        availability: "partial",
        detail: "Only selected fields, sanitized and length-capped, were extracted from the raw issue body.",
    },
];
function fieldAvailability(present, truncatedFields, field) {
    if (!present)
        return "not_provided";
    return truncatedFields.includes(field) ? "partial" : "available_and_corresponded";
}
/**
 * deriveReviewEvidenceBasis — the bounded basis for one review verdict.
 * Pure: a function of the extract the system constructed and the access
 * outcome — never of the classifier's output text.
 */
function deriveReviewEvidenceBasis(mode, accessStatus, extractHash, truncatedFields, presence) {
    const suppliedToModel = accessStatus === "ok" || accessStatus === "no_api_key";
    const availabilityFor = (present, field) => {
        if (!suppliedToModel)
            return "retrieval_failed";
        return fieldAvailability(present, truncatedFields, field);
    };
    // Metadata is a bundle: title/kind/phase truncation makes the bundle partial.
    const metadataTruncated = ["title", "kind", "phase"].some((f) => truncatedFields.includes(f));
    const sources = [
        {
            source: "issue_metadata",
            availability: suppliedToModel
                ? (metadataTruncated ? "partial" : "available_and_corresponded")
                : "retrieval_failed",
            detail: accessStatus === "api_error"
                ? "Issue metadata extract was constructed but supply to the model failed (API error)."
                : metadataTruncated
                    ? "Issue metadata (title/kind/phase) was supplied after length-capping or elision — a partial extract."
                    : "Issue number, title, kind, phase, reporter, and capture time were supplied (sanitized).",
        },
        {
            source: "task_inputs",
            availability: availabilityFor(presence.taskInputs, "task_inputs"),
            detail: truncatedFields.includes("task_inputs")
                ? "Task input(s) were supplied after length-capping or elision — a partial extract."
                : "Task input(s) were supplied as parsed from the issue body.",
        },
        {
            source: "failure_note",
            availability: availabilityFor(presence.failureNote, "failure_note"),
            detail: truncatedFields.includes("failure_note")
                ? "The failure note was supplied after length-capping or elision — a partial extract."
                : "The failure note was supplied as parsed from the issue body.",
        },
        {
            source: "reporter_notes",
            availability: availabilityFor(presence.notes, "reporter_notes"),
            detail: presence.notes
                ? (truncatedFields.includes("reporter_notes")
                    ? "Reporter notes were supplied after length-capping or elision — a partial extract."
                    : "Reporter notes were supplied as parsed from the issue body.")
                : "No reporter notes were present on the issue.",
        },
        ...NEVER_SUPPLIED_SOURCES,
    ];
    return {
        mode,
        ...(mode === "ai" ? { model: REVIEWER_MODEL_ID } : {}),
        extractHash,
        truncatedFields,
        accessStatus,
        completeness: "partial_bounded_extract",
        derivation: SYSTEM_STRUCTURAL_DERIVATION_V1,
        sources,
        evidenceBackedContradiction: "not_established",
        comprehension: "not_established",
    };
}
// ─── Claude API call ──────────────────────────────────────────────────────────
/** The single model identity used for AI review. Referenced by the API call
 * AND the P4 evidence-basis record — one source of truth, no drift. */
const REVIEWER_MODEL_ID = "claude-haiku-4-5";
async function callClaude(userMessage) {
    const apiKey = loadAnthropicKey();
    if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is not set.\n" +
            "  Add it to ~/.usesteady/.env:\n" +
            "    ANTHROPIC_API_KEY=sk-ant-...\n" +
            "  Or set it as an environment variable before running.");
    }
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body: JSON.stringify({
            model: REVIEWER_MODEL_ID,
            max_tokens: 256,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
        }),
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`Anthropic API ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    const text = data.content.find(b => b.type === "text")?.text ?? "";
    return text.trim();
}
// ─── Rule-based fallback ──────────────────────────────────────────────────────
const JUNK_PATTERNS = [
    /^(test|aaa+|bbb+|xxx+|zzz+|foo|bar|baz|\?+|\.+|123+|abc)$/i,
    /^.{1,3}$/, // fewer than 4 chars
];
const NATURAL_LANGUAGE_SIGNALS = [
    /\b(add|create|update|fix|remove|rename|delete|move|refactor|change|install|run|build|generate)\b/i,
    /\b(file|folder|component|function|class|test|style|config|readme|button|page|route|api)\b/i,
];
/**
 * Rule-based classifier — runs when ANTHROPIC_API_KEY is unavailable.
 * Deterministic, free, and good enough for obvious cases.
 */
function ruleBasedClassify(issue) {
    const ctx = parseIssueContext(issue.body);
    const inputs = ctx.taskInputs ?? [];
    const primaryInput = inputs[0] ?? "";
    const failureNote = ctx.failureNote ?? "";
    const kind = ctx.kind ?? "";
    // P4: the rule-based classifier consumes the raw parsed fields (no
    // sanitization length-caps apply). The extract identity is the hash of
    // exactly those fields; the basis records the same never-supplied sources.
    const evidenceBasis = deriveReviewEvidenceBasis("rule_based", "no_api_key", hashObject({ taskInputs: inputs, failureNote, kind }), [], {
        taskInputs: inputs.length > 0,
        failureNote: failureNote.trim().length > 0,
        notes: typeof ctx.notes === "string" && ctx.notes.trim().length > 0,
    });
    // Server errors are not UX friction — skip for human review
    if (kind === "server-error") {
        return { decision: "skip", reason: "Server errors need manual review.", confidence: 70, evidenceBasis };
    }
    // Obvious junk inputs — reject
    for (const pattern of JUNK_PATTERNS) {
        if (pattern.test(primaryInput.trim())) {
            return {
                decision: "rejected",
                reason: `Task input "${primaryInput}" is too short or pattern-matches known junk.`,
                confidence: 90,
                evidenceBasis,
            };
        }
    }
    // skipped_by_intake with natural-language input — approve
    const isSkippedByIntake = failureNote.includes("skipped_by_intake");
    const looksNatural = NATURAL_LANGUAGE_SIGNALS.some(p => p.test(primaryInput));
    if (isSkippedByIntake && looksNatural && primaryInput.length > 8) {
        return {
            decision: "approved",
            reason: `Task "${primaryInput}" looks like genuine natural language that intake should handle better.`,
            confidence: 72,
            evidenceBasis,
        };
    }
    if (isSkippedByIntake && primaryInput.length > 8) {
        return {
            decision: "skip",
            reason: `Task "${primaryInput}" — skipped_by_intake but language is ambiguous. Needs human review.`,
            confidence: 55,
            evidenceBasis,
        };
    }
    return {
        decision: "skip",
        reason: "Could not determine validity with rule-based classifier. Set ANTHROPIC_API_KEY for AI review.",
        confidence: 0,
        evidenceBasis,
    };
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Classify a single GitHub friction issue.
 * Uses Claude when ANTHROPIC_API_KEY is available; falls back to rule-based
 * heuristics otherwise (good for demos and offline use).
 * Returns a ReviewVerdict with decision, reason, and confidence.
 */
export async function classifyReport(issue) {
    // Use rule-based fallback when no API key is configured
    if (!loadAnthropicKey()) {
        return ruleBasedClassify(issue);
    }
    // P4: build the bounded extract first — the evidence basis is a fact about
    // what the SYSTEM constructed, established before/independently of any
    // model output. extractHash is over the exact message string sent.
    const extract = buildUserMessage(issue);
    const presence = {
        taskInputs: extract.hasTaskInputs,
        failureNote: extract.hasFailureNote,
        notes: extract.hasNotes,
    };
    const extractHash = hashObject(extract.message);
    try {
        const raw = await callClaude(extract.message);
        // Strip any accidental markdown fences
        const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(json);
        const decision = ["approved", "rejected", "skip"].includes(parsed.decision)
            ? parsed.decision
            : "skip";
        const reason = typeof parsed.reason === "string" ? parsed.reason : "No reason returned.";
        const confidence = typeof parsed.confidence === "number"
            ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
            : 50;
        return {
            decision,
            reason,
            confidence,
            evidenceBasis: deriveReviewEvidenceBasis("ai", "ok", extractHash, extract.truncatedFields, presence),
        };
    }
    catch (err) {
        // P4: the API call failed — the constructed extract never produced a model
        // judgment. The basis records retrieval_failed for the model-bound
        // sources; this skip is a SYSTEM decision, never a model contradiction.
        return {
            decision: "skip",
            reason: `Classifier error: ${String(err)}`,
            confidence: 0,
            evidenceBasis: deriveReviewEvidenceBasis("ai", "api_error", extractHash, extract.truncatedFields, presence),
        };
    }
}
/**
 * Classify a batch of issues, printing progress to stderr.
 * Returns results in the same order as the input array.
 */
export async function classifyBatch(issues) {
    const results = [];
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        process.stderr.write(`  Classifying #${issue.number} (${i + 1}/${issues.length})...\r`);
        const verdict = await classifyReport(issue);
        results.push({ issue, verdict });
        // Polite delay to avoid rate limits
        if (i < issues.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    process.stderr.write(" ".repeat(60) + "\r"); // clear progress line
    return results;
}
//# sourceMappingURL=reviewer.js.map