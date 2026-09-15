/**
 * renderSurfaceCli — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 3C).
 *
 * The CLI peer of `ui/src/components/workflow/renderSurfaceWeb.tsx`. Given a
 * RoutingSurface engine object, returns the terminal lines that present it. Both
 * renderers consume the SAME object, so the CLI and web cannot diverge on what a
 * routing outcome means — only on presentation bytes.
 *
 * Zero authority (Invariant 1): this is a pure RoutingSurface -> string[] mapping.
 * It never executes, approves, or gates. Authority stays with Safety / Approval /
 * Decision Basis / Execution gate.
 *
 * Total over SurfaceType: every one of the six variants renders truthful, non-empty
 * content (asserted by scripts/cert-render-surface-cli.ts). The `safety` and
 * `system_will` branches mirror the CLI's existing copy (`[blocked]` block and the
 * `SYSTEM WILL` / `-> headline` approval header) so the eventual entry wiring is
 * behavior-identical.
 */

import type {
  RoutingSurface,
  SafetySurface,
  WillSurface,
  WillOperation,
  SuggestSurface,
  ReflectionSurface,
  ClarifySurface,
  WorkPlanSurface,
  SurfaceDiff,
} from "../workflow/routing-surface.js";

export function renderSurfaceCli(surface: RoutingSurface): readonly string[] {
  switch (surface.type) {
    case "safety":          return renderSafety(surface);
    case "system_will":     return renderWill(surface);
    case "system_suggests": return renderSuggests(surface);
    case "reflection":      return renderReflection(surface);
    case "clarify":         return renderClarify(surface);
    case "work_plan":       return renderWorkPlan(surface);
  }
}

// ─── safety ───────────────────────────────────────────────────────────────────

function renderSafety(s: SafetySurface): readonly string[] {
  // Footer is keyed on the detector identity carried by the surface (Phase 4
  // 4-pre): the git-history evasion detector gets a git-specific message, every
  // other block gets the generic capability footer. Keeping this inside the pure
  // renderer (rather than at each call site) is what lets ALL CLI entry paths
  // (NL, draft, json) present the SAME safety RoutingSurface byte-identically.
  const footer =
    s.detectorId === "evasion_or_rule_bypass"
      ? [
          "  UseSteady does not process git operations that rewrite or delete history.",
          "  Run these commands directly in your terminal with explicit intent.",
        ]
      : [
          "  UseSteady supports safe file operations and validated commands.",
          "  Privilege escalation, shell injection, and bulk destructive ops are not supported.",
        ];
  return [
    "",
    "  [blocked] UseSteady can't process this request.",
    `     Reason: ${s.note}`,
    "",
    ...footer,
    "",
  ];
}

// ─── system_will ───────────────────────────────────────────────────────────────

function renderWill(s: WillSurface): readonly string[] {
  const lines: string[] = ["", "  SYSTEM WILL", `  -> ${s.headline}`];
  const opLine = willOperationLine(s.operation);
  if (opLine) lines.push(`     ${opLine}`);
  if (s.preview) lines.push(...previewLines(s.preview));
  lines.push("");
  return lines;
}

function willOperationLine(op: WillOperation): string | null {
  switch (op.operationType) {
    case "create_dir":   return `Create directory: ${op.dirPath}`;
    case "write_file":   return `Create file: ${op.filePath}`;
    case "append_file":  return `Append to: ${op.filePath}`;
    case "prepend_file": return `Prepend to: ${op.filePath}`;
    case "rename":       return `Rename ${op.filePath} -> ${op.newPath}`;
    case "delete_file":  return `Delete: ${op.filePath}`;
    case "run_command":  return `Run command: ${op.command}`;
    case "replace":      return `Replace in ${op.filePath}: "${op.oldValue}" -> "${op.newValue}"`;
  }
}

function previewLines(diff: SurfaceDiff): readonly string[] {
  const out: string[] = [`     ${diff.filePath}`];
  for (const h of diff.hunks) {
    const prefix = h.kind === "added" ? "+" : h.kind === "removed" ? "-" : " ";
    out.push(`       ${prefix} ${h.line}`);
  }
  return out;
}

// ─── system_suggests ───────────────────────────────────────────────────────────

function renderSuggests(s: SuggestSurface): readonly string[] {
  const lines: string[] = [
    "",
    "  SYSTEM SUGGESTS",
    "  Concrete alternatives -- each still requires your approval:",
  ];
  for (const item of s.suggestions) {
    lines.push(`    - ${item.input}`);
    if (item.reason) lines.push(`        ${item.reason}`);
  }
  lines.push("");
  return lines;
}

// ─── reflection ────────────────────────────────────────────────────────────────

function renderReflection(s: ReflectionSurface): readonly string[] {
  const lines: string[] = [
    "",
    "  COULD NOT UNDERSTAND",
    `  I believe: ${s.summary}`,
  ];
  for (const point of s.keyPoints) {
    lines.push(`    - ${point}`);
  }
  lines.push(`  Next: ${s.nextStep}`);
  lines.push("");
  return lines;
}

// ─── clarify ───────────────────────────────────────────────────────────────────

function renderClarify(s: ClarifySurface): readonly string[] {
  if (s.clarify.mode === "slot_fill") {
    return ["", `  ${s.clarify.prompt}`, ""];
  }
  const c = s.clarify.commitment;
  return [
    "",
    `  Understood: ${c.understood}`,
    `  Missing: ${c.missing}`,
    `  ${c.ask}`,
    "",
  ];
}

// ─── work_plan ─────────────────────────────────────────────────────────────────

function renderWorkPlan(s: WorkPlanSurface): readonly string[] {
  const wp = s.workPlan;
  const lines: string[] = ["", "  WORK PLAN", `  Goal: ${wp.goal}`];
  wp.tasks.forEach((t, i) => {
    lines.push(`    ${i + 1}. ${t.action} ${t.target} -> ${t.outcome}`);
  });
  lines.push(`  Next: ${wp.nextAction}`);
  lines.push("");
  return lines;
}
