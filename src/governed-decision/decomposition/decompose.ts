/**
 * Decomposition proposer — D1 (delivery-map slice: Decomposition Machinery).
 *
 * Turns ONE messy conversation into N candidate work items, each carrying a
 * canonical deterministic goal phrase, a KERNEL-DERIVED risk class, and
 * bounded stop conditions. Every item is a CANDIDATE: nothing here decides,
 * ratifies, or executes. The loop driver (loop.ts) runs each item through the
 * full governed spine — one thread per item, one ratification per item.
 *
 * ── Invariants (D1) ───────────────────────────────────────────────────────────
 *
 *   INV-D1-1  Deterministic re-validation, fail-full: every item's canonical
 *             phrase must re-parse through the frozen deterministic parser
 *             (`normalizeIntent`) into the NON-DESTRUCTIVE executable subset
 *             and reproduce the proposed operation exactly. ONE invalid item
 *             rejects the WHOLE decomposition (a silently-dropped item would
 *             present a different decomposition than the model proposed).
 *
 *   INV-D1-2  Risk class is kernel-derived from the re-parsed operation kind,
 *             NEVER model-asserted. The model cannot label its own risk.
 *
 *   INV-D1-4  Bounded: at most MAX_WORK_ITEMS items, MAX_STOP_CONDITIONS stop
 *             conditions per item, bounded string lengths, bounded input
 *             conversation size. Anything over a bound → null (fail-closed).
 *
 *   INV-D1-6  Source provenance: the proposal carries the SHA-256 of the
 *             verbatim conversation. The loop driver declares it as an
 *             `asserted_artifact` reference on every item's record, so all N
 *             items are lineage-linked to the same source conversation at the
 *             honest `unverified` authority band (INV-EIL-5 — a conversation
 *             is a claim, not verified system state).
 *
 * Mirrors the AI_SEAMS_V1 seam discipline of src/intake/candidate-plan.ts:
 * injectable model call, one attempt, fail-closed on every malformed path
 * (INV-AI-3), and the phrases that eventually execute are deterministic
 * re-parse products — never raw model output (INV-AI-6).
 */

import { createHash } from "node:crypto";

import { createProposerModelCall } from "../../ai-seams/proposer-model-call.js";
import { extractJsonText } from "../../intake/llm-classifier.js";
import {
  normalizeIntent,
  describeIntent,
} from "../../understand/interpretation/intent.js";
import type { ExecutableOperation } from "../types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Kernel risk vocabulary for a candidate work item. Derived by
 * {@link deriveRiskClass} from the re-parsed operation — a discrete
 * classification over the operation kind, never a guessed probability and
 * never trusted from the model (INV-D1-2).
 */
export type WorkItemRiskClass = "low" | "medium" | "high";

/** One candidate work item — plain data, zero authority. */
export type CandidateWorkItem = {
  /** Canonical deterministic goal phrase (`mkdir <path>` / `touch <path>`). */
  readonly goal: string;
  /** Human-readable summary derived from the deterministic RE-PARSE. */
  readonly summary: string;
  /** The re-parse product this item would execute if ratified. */
  readonly operation: ExecutableOperation;
  /** Kernel-derived risk class (INV-D1-2). */
  readonly riskClass: WorkItemRiskClass;
  /**
   * Model-proposed stop conditions — advisory text presented to the ratifier
   * alongside the item. Bounded, sanitized strings; carry no authority.
   */
  readonly stopConditions: readonly string[];
};

export type DecompositionProposal = {
  readonly items: readonly CandidateWorkItem[];
  /** SHA-256 (hex) of the verbatim source conversation (INV-D1-6). */
  readonly conversationSha256: string;
};

/** Injectable model call for tests; production uses the Anthropic default. */
export type DecompositionModelCall = (
  system: string,
  user: string,
) => Promise<string | null>;

// ─── Bounds (INV-D1-4) ────────────────────────────────────────────────────────

export const MAX_WORK_ITEMS = 7;
export const MAX_STOP_CONDITIONS = 4;
export const MAX_STOP_CONDITION_LENGTH = 200;
export const MAX_CONVERSATION_CHARS = 20_000;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a work decomposer for UseSteady, a governed file-operation tool.

## Your job
Read the conversation and extract 1-${MAX_WORK_ITEMS} concrete, independent filesystem
work items. Return ONLY a valid JSON object. No prose, no markdown.

## Allowed operations (the ONLY two — never propose anything else)
- create_dir  — create a directory
- create_file — create an empty file

## HARD RULES
- Paths must be RELATIVE (no leading slash, no drive letter, no "..").
- Paths must come from the conversation or be the obvious minimal structure
  for it. Never invent unrelated work.
- Each item may carry up to ${MAX_STOP_CONDITIONS} short "stopConditions": plain-language
  conditions under which work on that item must stop and return to a human.
- If the conversation requires renaming, deleting, editing, or running
  anything, that part is NOT decomposable: leave it out. If nothing is
  decomposable, return {"items": []}.
- Never exceed ${MAX_WORK_ITEMS} items.

## JSON output schema
{"items": [{"op": "create_dir" | "create_file", "path": "<relative path>", "stopConditions": ["<condition>"]}]}

Return ONLY valid JSON.`;

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Conservative lexical path hygiene for model-proposed paths (same rules as
 * the candidate-plan seam). The sandboxed executor still enforces real
 * containment — this rejects shapes a proposal has no business containing.
 */
function isSafeRelativeItemPath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  if (!/^[A-Za-z0-9_\-./]+$/.test(path)) return false;
  if (path.startsWith("/") || path.startsWith(".")) return false;
  const segments = path.split("/");
  return segments.every((s) => s.length > 0 && s !== ".." && s !== ".");
}

/**
 * Derive the risk class from the operation kind — total over the kernel's
 * executable-operation union (INV-D1-2). The v1 decomposition subset is
 * non-destructive, so every valid item lands "low"; the mapping is still
 * exhaustive so a future op kind cannot silently pass as low.
 */
export function deriveRiskClass(op: ExecutableOperation): WorkItemRiskClass {
  switch (op.kind) {
    case "create_dir":
    case "create_file":
      return "low";
    case "replace_in_file":
      return "medium";
    case "delete_file":
      // Destructive: the op removes content. Decomposition never PROPOSES a
      // delete (INV-A1-3 — validateItem admits only the non-destructive
      // subset); the classification exists so the risk mapping stays total.
      return "high";
    case "human_attest":
    case "document_record":
      // Preserve the conservative fallback used before these union members were explicit.
      return "high";
    case "rename_file":
      // Destructive of location: the op removes the source path. Decomposition
      // never PROPOSES a rename (same INV-A1-3 boundary); the classification
      // exists so the risk mapping stays total.
      return "high";
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return "high";
    }
  }
}

/** Validate one model-proposed stop-condition list into bounded plain text. */
function validateStopConditions(raw: unknown): readonly string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_STOP_CONDITIONS) return null;
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string") return null;
    const trimmed = c.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_STOP_CONDITION_LENGTH) return null;
    // Reject control characters — stop conditions are rendered to a ratifier.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
    out.push(trimmed);
  }
  return out;
}

type RawItem = {
  readonly op?: unknown;
  readonly path?: unknown;
  readonly stopConditions?: unknown;
};

/**
 * Validate one raw model item into a canonical, deterministically re-parsed
 * candidate work item, or null when anything is off (INV-D1-1). The phrase,
 * summary, operation and risk class are all derived from the RE-PARSE, not
 * from the model text.
 */
function validateItem(raw: RawItem): CandidateWorkItem | null {
  const op = raw.op;
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (op !== "create_dir" && op !== "create_file") return null;
  if (!isSafeRelativeItemPath(path)) return null;

  const stopConditions = validateStopConditions(raw.stopConditions);
  if (stopConditions === null) return null;

  // Canonical phrase in the frozen grammar.
  const goal = op === "create_dir" ? `mkdir ${path}` : `touch ${path}`;

  // INV-D1-1 gate: the phrase must land inside the frozen deterministic parser
  // and reproduce exactly the proposed operation.
  const parsed = normalizeIntent(goal);
  if (parsed === null || parsed.kind !== op) return null;
  if (parsed.path !== path) return null;

  const operation: ExecutableOperation =
    op === "create_dir"
      ? { kind: "create_dir", path }
      : { kind: "create_file", path, content: "" };

  return {
    goal,
    summary: describeIntent(parsed),
    operation,
    riskClass: deriveRiskClass(operation),
    stopConditions,
  };
}

// ─── Conversation hashing (INV-D1-6) ──────────────────────────────────────────

export function hashConversation(conversation: string): string {
  return createHash("sha256").update(conversation, "utf8").digest("hex");
}

// ─── Default model call (Moonshot/Kimi default / Anthropic R6 — INV-AI-5) ────────────

const defaultDecompositionCall = createProposerModelCall({ maxTokens: 1024 });

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Propose a candidate decomposition of one messy conversation. Returns null on
 * every failure path — oversized input, no model, malformed JSON, item count
 * out of bounds, or ANY item failing deterministic re-validation (fail-full,
 * INV-D1-1). The caller must treat null as "nothing decomposable" and change
 * no behavior.
 */
export async function proposeDecomposition(
  conversation: string,
  callModel: DecompositionModelCall = defaultDecompositionCall,
): Promise<DecompositionProposal | null> {
  const trimmed = conversation.trim();
  if (trimmed.length === 0 || conversation.length > MAX_CONVERSATION_CHARS) {
    return null;
  }

  let text: string | null;
  try {
    text = await callModel(SYSTEM_PROMPT, conversation);
  } catch {
    return null;
  }
  if (text === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonText(text));
  } catch {
    return null;
  }

  if (raw === null || typeof raw !== "object") return null;
  const itemsRaw = (raw as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) return null;
  if (itemsRaw.length === 0 || itemsRaw.length > MAX_WORK_ITEMS) return null;

  // Fail-full, fail-closed (INV-D1-1): ONE invalid item rejects the whole
  // decomposition — a silently-thinned decomposition would misrepresent what
  // the model proposed and what a ratifier believes they are reviewing.
  const items: CandidateWorkItem[] = [];
  for (const r of itemsRaw) {
    const item = validateItem(r as RawItem);
    if (item === null) return null;
    items.push(item);
  }

  return { items, conversationSha256: hashConversation(conversation) };
}
