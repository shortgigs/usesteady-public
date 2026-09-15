/**
 * W-E4 / B.S2 — Router table: adopted executorClass → delivery backend kind.
 *
 * CP-4: executorClass is a proposal until the Router acts after H approval.
 * This module is that Router act for V2-anchored handoffs. It does NOT
 * implement attestation or document executors (B.S3 / B.S4) — it only
 * selects the delivery kind string.
 *
 * Path A (no adopted V2 summaries) keeps the workspace-derived kind.
 */

export type CandidateExecutorClass =
  | "repo_change"
  | "document"
  | "cli"
  | "human"
  | "external";

/** Backend kinds the Router may emit on delivery / ratify. */
export type RoutedExecutorKind =
  | "human-attestation"
  | "document-record"
  | "fs"
  | `scm-${string}`
  | "unsupported";

const CLASS_PREFIX = /^\[(repo_change|document|cli|human|external)\]\s*/i;

/**
 * True when a B.S1 summary line carries a concrete relative path the human
 * reviewed (e.g. `create: src/foo.ts — …`). Paths are never invented — only
 * detected from the ratified summary text (CP-6).
 */
export function summaryHasScaffoldPath(summary: string): boolean {
  const afterClass = summary.replace(CLASS_PREFIX, "");
  const afterAction = afterClass.includes(":")
    ? afterClass.slice(afterClass.indexOf(":") + 1).trim()
    : afterClass.trim();
  const pathMatch = afterAction.match(
    /^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/,
  );
  return Boolean(pathMatch?.[1] && pathMatch[1].replace(/\/+$/, "").length > 0);
}

/**
 * Recover executorClass tags embedded in B.S1 summary-only plan lines
 * (`[human] action: deliverable — outcome`).
 */
export function extractExecutorClassesFromSummaries(
  summaries: readonly string[],
): readonly CandidateExecutorClass[] {
  const out: CandidateExecutorClass[] = [];
  for (const raw of summaries) {
    const match = raw.trim().match(CLASS_PREFIX);
    if (match?.[1]) {
      out.push(match[1].toLowerCase() as CandidateExecutorClass);
    }
  }
  return out;
}

/**
 * Pure routing table (B.S2).
 *
 * Priority when multiple classes appear on one adopted plan:
 *   repo_change OR path-bearing scaffold → workspace backend kind (fs / scm-*)
 *   human → human-attestation
 *   document → document-record
 *   cli / external → unsupported (fail closed at call site if sole class)
 *
 * CP REV_1: a single `document` task (e.g. README.md) must not swallow a
 * scaffold that also carries `repo_change` file creates — filesystem wins.
 *
 * CP REV_1 follow-up: model-tagged `[document]` lines that still carry a
 * concrete relative path (mis-tagged scaffolds) also win over document-record.
 * Pure prose document plans (no path) stay document-record.
 *
 * When `classes` is empty, return the workspace kind unchanged (Path A).
 */
export function routeExecutorKind(input: {
  readonly classes: readonly CandidateExecutorClass[];
  readonly workspaceKind: string | null | undefined;
  /** True when any ratified summary carries a concrete relative path. */
  readonly pathBearing?: boolean;
}): RoutedExecutorKind | string {
  const classes = input.classes;
  if (classes.length === 0) {
    const ws = typeof input.workspaceKind === "string" ? input.workspaceKind.trim() : "";
    return ws.length > 0 ? ws : "unsupported";
  }

  if (classes.includes("repo_change") || input.pathBearing === true) {
    const ws = typeof input.workspaceKind === "string" ? input.workspaceKind.trim() : "";
    if (ws.length > 0) return ws;
    return "fs";
  }
  if (classes.includes("human")) return "human-attestation";
  if (classes.includes("document")) return "document-record";
  return "unsupported";
}

/**
 * Read candidate plan summaries from a stored governed draft/final record.
 */
export function summariesFromGovernedRecord(record: {
  readonly understanding?: unknown;
}): readonly string[] {
  const section = record.understanding as
    | { status?: unknown; value?: { candidatePlans?: unknown } }
    | undefined;
  if (section === undefined || section.status !== "connected") return [];
  const plans = section.value?.candidatePlans;
  if (!Array.isArray(plans)) return [];
  const out: string[] = [];
  for (const p of plans) {
    const summary = (p as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim().length > 0) {
      out.push(summary.trim());
    }
  }
  return out;
}

/** True when the draft already carries create_file / create_dir ops. */
export function draftHasScaffoldOps(record: {
  readonly understanding?: unknown;
}): boolean {
  const section = record.understanding as
    | { status?: unknown; value?: { candidatePlans?: unknown } }
    | undefined;
  if (section === undefined || section.status !== "connected") return false;
  const plans = section.value?.candidatePlans;
  if (!Array.isArray(plans)) return false;
  for (const p of plans) {
    const kind = (p as { operation?: { kind?: unknown } }).operation?.kind;
    if (kind === "create_file" || kind === "create_dir") return true;
  }
  return false;
}

/**
 * Resolve the delivery executor kind for a ratified handoff draft.
 */
export function resolveRoutedExecutorKind(input: {
  readonly draftRecord: { readonly understanding?: unknown };
  readonly workspaceKind: string | null | undefined;
}): string | null {
  const summaries = summariesFromGovernedRecord(input.draftRecord);
  const classes = extractExecutorClassesFromSummaries(summaries);
  const pathBearing =
    draftHasScaffoldOps(input.draftRecord) ||
    summaries.some((s) => summaryHasScaffoldPath(s));
  if (classes.length === 0) {
    // Path A / untagged: path-bearing scaffolds still take the workspace kind.
    if (pathBearing) {
      const ws = typeof input.workspaceKind === "string" ? input.workspaceKind.trim() : "";
      return ws.length > 0 ? ws : "fs";
    }
    const ws = typeof input.workspaceKind === "string" ? input.workspaceKind.trim() : "";
    return ws.length > 0 ? ws : null;
  }
  const routed = routeExecutorKind({
    classes,
    workspaceKind: input.workspaceKind,
    pathBearing,
  });
  if (routed === "unsupported") return null;
  return routed;
}
