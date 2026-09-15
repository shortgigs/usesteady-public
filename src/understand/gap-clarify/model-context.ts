/**
 * Renders the portal's understanding-model-context wire into a model user prompt.
 */

export const UNDERSTANDING_MODEL_CONTEXT_FORMAT =
  "usesteady.understanding-model-context.v1" as const;

export type UnderstandingModelContextPurpose =
  | "draft_intent"
  | "gap_clarify";

export type GapClarifyPriorRound = {
  readonly question: string;
  readonly signal: "no" | "unsure";
  readonly suggestions: readonly string[];
};

export type MemoryScanScope = "none" | "pointer" | "lineage" | "catalog";

export type WorkflowMemoryLedgerEntry = {
  readonly role: "current_pointer" | "prior_version" | "related_work_item";
  readonly workItemId: string;
  readonly memoryPointId: string;
  readonly zestText: string;
  readonly ratifiedVersion: number;
  readonly ratifiedAt: string;
};

export type UnderstandingModelContextWireV1 = {
  readonly format: typeof UNDERSTANDING_MODEL_CONTEXT_FORMAT;
  readonly purpose: UnderstandingModelContextPurpose;
  readonly heldRequest: string;
  readonly conversationLedger: readonly {
    readonly text: string;
    readonly included: boolean;
  }[];
  readonly inferredDraft: string | null;
  readonly openQuestions: readonly string[];
  readonly priorGapClarifications: readonly GapClarifyPriorRound[];
  readonly activeGapQuestion: string | null;
  readonly gapAnswerSignal: "no" | "unsure" | null;
  readonly memoryScanScope: MemoryScanScope;
  readonly workflowMemoryLedger: readonly WorkflowMemoryLedgerEntry[];
};

function parseLedger(raw: unknown): { text: string; included: boolean }[] {
  const conversationLedger: { text: string; included: boolean }[] = [];
  if (!Array.isArray(raw)) return conversationLedger;
  for (const row of raw) {
    if (row === null || typeof row !== "object") continue;
    const text = (row as { text?: unknown }).text;
    const included = (row as { included?: unknown }).included;
    if (typeof text === "string" && text.trim().length > 0) {
      conversationLedger.push({
        text: text.trim(),
        included: included === true,
      });
    }
  }
  return conversationLedger;
}

function parseMemoryLedger(raw: unknown): WorkflowMemoryLedgerEntry[] {
  const workflowMemoryLedger: WorkflowMemoryLedgerEntry[] = [];
  if (!Array.isArray(raw)) return workflowMemoryLedger;
  for (const row of raw) {
    if (row === null || typeof row !== "object") continue;
    const role = (row as { role?: unknown }).role;
    const workItemId = (row as { workItemId?: unknown }).workItemId;
    const memoryPointId = (row as { memoryPointId?: unknown }).memoryPointId;
    const zestText = (row as { zestText?: unknown }).zestText;
    const ratifiedVersion = (row as { ratifiedVersion?: unknown }).ratifiedVersion;
    const ratifiedAt = (row as { ratifiedAt?: unknown }).ratifiedAt;
    if (
      (role !== "current_pointer" &&
        role !== "prior_version" &&
        role !== "related_work_item") ||
      typeof workItemId !== "string" ||
      typeof memoryPointId !== "string" ||
      typeof zestText !== "string" ||
      zestText.trim().length === 0 ||
      typeof ratifiedVersion !== "number"
    ) {
      continue;
    }
    workflowMemoryLedger.push({
      role,
      workItemId: workItemId.trim(),
      memoryPointId: memoryPointId.trim(),
      zestText: zestText.trim(),
      ratifiedVersion,
      ratifiedAt:
        typeof ratifiedAt === "string" ? ratifiedAt.trim() : "",
    });
  }
  return workflowMemoryLedger;
}

function parseMemoryScanScope(raw: unknown): MemoryScanScope {
  if (
    raw === "none" ||
    raw === "pointer" ||
    raw === "lineage" ||
    raw === "catalog"
  ) {
    return raw;
  }
  return "none";
}

function parsePriorRounds(raw: unknown): GapClarifyPriorRound[] {
  const priorGapClarifications: GapClarifyPriorRound[] = [];
  if (!Array.isArray(raw)) return priorGapClarifications;
  for (const round of raw) {
    if (round === null || typeof round !== "object") continue;
    const question =
      typeof (round as { question?: unknown }).question === "string"
        ? (round as { question: string }).question.trim()
        : "";
    const roundSignal = (round as { signal?: unknown }).signal;
    const suggestionsRaw = (round as { suggestions?: unknown }).suggestions;
    if (!question || (roundSignal !== "no" && roundSignal !== "unsure")) {
      continue;
    }
    const suggestions: string[] = [];
    if (Array.isArray(suggestionsRaw)) {
      for (const s of suggestionsRaw) {
        if (typeof s === "string" && s.trim().length > 0) {
          suggestions.push(s.trim());
        }
      }
    }
    priorGapClarifications.push({ question, signal: roundSignal, suggestions });
  }
  return priorGapClarifications;
}

export function parseUnderstandingModelContextWire(
  raw: unknown,
): UnderstandingModelContextWireV1 | null {
  if (raw === null || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (body.format !== UNDERSTANDING_MODEL_CONTEXT_FORMAT) return null;

  const purpose = body.purpose;
  if (purpose !== "draft_intent" && purpose !== "gap_clarify") return null;

  const heldRequest =
    typeof body.heldRequest === "string" ? body.heldRequest.trim() : "";
  if (!heldRequest) return null;

  const activeGapQuestionRaw =
    typeof body.activeGapQuestion === "string"
      ? body.activeGapQuestion.trim()
      : "";
  const signal = body.gapAnswerSignal;

  if (purpose === "gap_clarify") {
    if (!activeGapQuestionRaw) return null;
    if (signal !== "no" && signal !== "unsure") return null;
  }

  const inferredDraft =
    typeof body.inferredDraft === "string" && body.inferredDraft.trim().length > 0
      ? body.inferredDraft.trim()
      : null;

  const openQuestions: string[] = [];
  if (Array.isArray(body.openQuestions)) {
    for (const q of body.openQuestions) {
      if (typeof q === "string" && q.trim().length > 0) {
        openQuestions.push(q.trim());
      }
    }
  }

  return {
    format: UNDERSTANDING_MODEL_CONTEXT_FORMAT,
    purpose,
    heldRequest,
    conversationLedger: parseLedger(body.conversationLedger),
    inferredDraft,
    openQuestions,
    priorGapClarifications: parsePriorRounds(body.priorGapClarifications),
    activeGapQuestion:
      purpose === "gap_clarify" ? activeGapQuestionRaw : null,
    gapAnswerSignal:
      purpose === "gap_clarify" && (signal === "no" || signal === "unsure")
        ? signal
        : null,
    memoryScanScope: parseMemoryScanScope(body.memoryScanScope),
    workflowMemoryLedger: parseMemoryLedger(body.workflowMemoryLedger),
  };
}

function appendSharedContextSections(
  lines: string[],
  wire: UnderstandingModelContextWireV1,
): void {
  lines.push(
    `PURPOSE: ${wire.purpose === "draft_intent" ? "Synthesize held request + open gaps" : "Clarify after No/Unsure on one gap"}`,
    "",
    "HELD REQUEST (current version the operator is building):",
    wire.heldRequest,
    "",
    "CONVERSATION LEDGER (every operator turn, verbatim):",
  );

  if (wire.conversationLedger.length === 0) {
    lines.push("- (none yet)");
  } else {
    for (const turn of wire.conversationLedger) {
      lines.push(
        `- [${turn.included ? "in held request" : "excluded"}] ${turn.text}`,
      );
    }
  }

  lines.push("");
  if (wire.inferredDraft) {
    lines.push("PRIOR MODEL INFERRED DRAFT (candidate, not ratified):");
    lines.push(wire.inferredDraft);
    lines.push("");
  }

  if (wire.priorGapClarifications.length > 0) {
    lines.push("PRIOR GAP CLARIFY ROUNDS (No/Unsure loops already shown):");
    for (const [i, round] of wire.priorGapClarifications.entries()) {
      lines.push(
        `Round ${i + 1} on "${round.question}" — operator said ${round.signal === "no" ? "No" : "Unsure"}:`,
      );
      for (const s of round.suggestions) {
        lines.push(`  - ${s}`);
      }
    }
    lines.push("");
  }

  if (wire.memoryScanScope !== "none" && wire.workflowMemoryLedger.length > 0) {
    lines.push(
      `WORKFLOW MEMORY LEDGER (scope: ${wire.memoryScanScope}; candidate recall only — NOT ratified for this session):`,
    );
    for (const entry of wire.workflowMemoryLedger) {
      lines.push(
        `- [${entry.role} v${entry.ratifiedVersion}] ${entry.zestText}`,
      );
    }
    lines.push("");
  }
}

export function renderUnderstandingModelContextPrompt(
  wire: UnderstandingModelContextWireV1,
): string {
  const lines: string[] = [
    "=== USESTEADY UNDERSTANDING MODEL CONTEXT (v1) ===",
    "",
  ];
  appendSharedContextSections(lines, wire);

  if (wire.purpose === "draft_intent") {
    lines.push(
      "TASK: Draft the held request cleanly. Fold EVERY included ledger line.",
      "Drop open_questions the ledger already answered. Never drop scope the operator gave.",
    );
    lines.push("");
    lines.push("=== END CONTEXT ===");
    return lines.join("\n");
  }

  if (wire.openQuestions.length > 0) {
    lines.push("OPEN GAPS (not decided yet):");
    for (const q of wire.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }

  lines.push("ACTIVE GAP QUESTION (operator must answer Yes to close):");
  lines.push(wire.activeGapQuestion ?? "");
  lines.push("");
  lines.push(
    `OPERATOR GAP ANSWER THIS ROUND: ${wire.gapAnswerSignal === "no" ? "No" : "Unsure"}`,
  );
  lines.push("");
  lines.push("=== END CONTEXT ===");
  return lines.join("\n");
}
