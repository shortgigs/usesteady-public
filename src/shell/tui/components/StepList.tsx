/**
 * TUI v1 — StepList component.
 *
 * Renders each step with a symbol and colour reflecting its status.
 * The current step (pending + id === currentStepId) gets a directional arrow.
 */

import React        from "react";
import { Box, Text } from "ink";
import type { TuiStep } from "../types.js";

type Props = {
  readonly steps:          readonly TuiStep[];
  readonly currentStepId:  number | undefined;
};

function symbol(step: TuiStep, isCurrent: boolean): string {
  if (isCurrent && step.status === "pending") return "→";
  switch (step.status) {
    case "completed": return "✓";
    case "failed":    return "✗";
    case "blocked":   return "✗";
    case "pending":            return "·";
    case "planning_reviewed":  return "-";
  }
}

function color(step: TuiStep, isCurrent: boolean): string {
  if (isCurrent && step.status === "pending") return "yellow";
  switch (step.status) {
    case "completed": return "green";
    case "failed":    return "red";
    case "blocked":   return "red";
    case "pending":            return "gray";
    case "planning_reviewed":  return "white";
  }
}

export function StepList({ steps, currentStepId }: Props) {
  if (steps.length === 0) return null;

  return (
    <Box flexDirection="column">
      {steps.map(step => {
        const isCurrent = step.id === currentStepId;
        const sym       = symbol(step, isCurrent);
        const col       = color(step, isCurrent);
        const num       = String(step.id + 1).padStart(2, " ");

        return (
          <Box key={step.id}>
            <Text color={col}>
              {"  "}[{num}] {sym}{"  "}{step.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
