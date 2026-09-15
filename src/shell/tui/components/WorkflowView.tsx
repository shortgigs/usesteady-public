/**
 * TUI v1 — WorkflowView (execution monitor).
 *
 * Composes the read-only workflow view:
 *   status line → step list → system will panel (when present)
 *
 * Renders only what is truthfully known.
 * ConsensusPanel and footer controls are deferred to a future pass.
 */

import React         from "react";
import { Box, Text } from "ink";
import { StepList }          from "./StepList.js";
import { SystemWillPanel }   from "./SystemWillPanel.js";
import { BlockedReasonPanel } from "./BlockedReasonPanel.js";
import { ConsensusPanel }      from "./ConsensusPanel.js";
import { useWorkflowState }  from "../hooks/useWorkflowState.js";
import type { WorkflowStatus } from "../types.js";

function statusColor(status: WorkflowStatus): string {
  switch (status) {
    case "Reviewing":  return "blue";
    case "Executing":  return "yellow";
    case "Blocked":    return "red";
    case "Completed":  return "green";
    case "Stopped":    return "gray";
  }
}

export function WorkflowView() {
  const state = useWorkflowState();

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {/* Status line + read-only label — prevents FAST persona keyboard attempts */}
      <Box justifyContent="space-between">
        <Box>
          <Text dimColor>{"  "}UseSteady  </Text>
          <Text bold color={statusColor(state.status)}>{state.status}</Text>
        </Box>
        <Text dimColor>  execution monitor — read only  </Text>
      </Box>

      {/* Step list */}
      <Box marginTop={1}>
        <StepList steps={state.steps} currentStepId={state.currentStepId} />
      </Box>

      {/* System Will — only when present */}
      <SystemWillPanel description={state.systemWill?.description} />

      {/* Blocked reason — only when status === Blocked */}
      <BlockedReasonPanel reason={state.blockedReason} />

      {/* Consensus panel — only when Blocked + multi-LLM data present */}
      <ConsensusPanel entries={state.consensus} />
    </Box>
  );
}
