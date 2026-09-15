import type { WorkflowTaskSpec } from "../workflow/types.js";

export type UnresolvedIntentCategory =
  | "missing_target"
  | "missing_content"
  | "missing_command"
  | "ambiguous_operation";

export function classifyUnresolvedIntent(
  _spec: WorkflowTaskSpec,
  reason: string,
): UnresolvedIntentCategory {
  const normalized = reason.toLowerCase();
  if (normalized.includes("target path") || normalized.includes("destination path")) {
    return "missing_target";
  }
  if (normalized.includes("content")) {
    return "missing_content";
  }
  if (normalized.includes("command")) {
    return "missing_command";
  }
  return "ambiguous_operation";
}

export function unresolvedReasonMessage(category: UnresolvedIntentCategory): string {
  switch (category) {
    case "missing_target":
      return "The request is missing a concrete target path.";
    case "missing_content":
      return "The request is missing concrete content for the operation.";
    case "missing_command":
      return "The request is missing a concrete command to run.";
    default:
      return "The request is ambiguous and cannot be executed deterministically.";
  }
}
