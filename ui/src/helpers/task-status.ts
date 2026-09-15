/**
 * Phase 11A-Web: Task status label and badge helpers.
 *
 * Pure helper — no React, no DOM, no network. Shared by WorkflowTaskSidebar
 * and history list components.
 */

import type { WorkflowTaskOutcome, WorkflowRunPhase } from "../api/types.js";
import type { HistoryTaskOutcome }                     from "../api/types.js";
import type { StatusTone }                             from "./status-tone.js";

// ─── Status badge config ──────────────────────────────────────────────────────

export type BadgeVariant =
  | "accepted"    // green
  | "failed"      // red
  | "skipped"     // amber
  | "stopped"     // orange
  | "pending"     // gray
  | "active"      // blue
  | "reviewing"   // indigo
  | "unknown";    // gray-dim

/**
 * Variant → semantic status tone. Single source of truth for mapping a badge
 * variant to a `status-tone` color, shared by `Badge`, run/step rows, and the
 * status-checks summary so chips, left-border accents, and counts stay in sync.
 * "stopped" is a benign halt, not an error → neutral.
 */
export const BADGE_VARIANT_TONE: Record<BadgeVariant, StatusTone> = {
  accepted:  "success",
  failed:    "danger",
  skipped:   "warning",
  stopped:   "neutral",
  pending:   "neutral",
  active:    "accent",
  reviewing: "accent",
  unknown:   "neutral",
};

export type TaskStatusBadge = {
  readonly label:   string;
  readonly variant: BadgeVariant;
};

// ─── WorkflowTask outcome → badge ─────────────────────────────────────────────

export function taskOutcomeBadge(
  outcome: WorkflowTaskOutcome | null,
): TaskStatusBadge {
  switch (outcome) {
    case "accepted":       return { label: "Accepted",    variant: "accepted" };
    case "rejected":       return { label: "Rejected",    variant: "failed"   };
    case "skipped":        return { label: "Skipped",     variant: "skipped"  };
    case "skipped_by_intake": return { label: "Skipped",  variant: "skipped"  };
    case "planning_reviewed": return { label: "Reviewed",   variant: "accepted" };
    case "stopped":        return { label: "Stopped",     variant: "stopped"  };
    case "pending":
    case null:             return { label: "Pending",     variant: "pending"  };
    default:               return { label: "Unknown",     variant: "unknown"  };
  }
}

// ─── History outcome → badge ──────────────────────────────────────────────────

export function historyOutcomeBadge(
  outcome: HistoryTaskOutcome,
): TaskStatusBadge {
  return taskOutcomeBadge(outcome as WorkflowTaskOutcome);
}

// ─── Workflow phase → run-level status badge ──────────────────────────────────

export function runPhaseBadge(phase: WorkflowRunPhase): TaskStatusBadge {
  switch (phase) {
    case "reviewing":      return { label: "Reviewing",  variant: "reviewing" };
    case "running":        return { label: "Running…",   variant: "active"    };
    case "task_ready":     return { label: "Ready",      variant: "active"    };
    case "task_conflict":  return { label: "Conflict",   variant: "failed"    };
    case "task_approved":  return { label: "Approved",   variant: "active"    };
    case "task_failed":    return { label: "Failed",     variant: "failed"    };
    case "task_scope":     return { label: "Scope?",     variant: "active"    };
    case "completed":      return { label: "Completed",  variant: "accepted"  };
    case "stopped":        return { label: "Stopped",    variant: "stopped"   };
    default:               return { label: "Unknown",    variant: "unknown"   };
  }
}

// ─── Task label display ───────────────────────────────────────────────────────

export function taskDisplayLabel(
  spec: { label?: string; input: string },
  idx:  number,
): string {
  return spec.label ?? `Task ${idx + 1}`;
}

// ─── Runtime badge ────────────────────────────────────────────────────────────

export function runtimeBadgeLabel(runtime: "cursor" | "claude"): string {
  return runtime === "cursor" ? "Local edit" : "Claude";
}

export function runtimeDescription(runtime: "cursor" | "claude"): string {
  return runtime === "cursor"
    ? "Writes directly to files in the selected workspace"
    : "Sends the approved task to Claude's runtime after approval";
}
