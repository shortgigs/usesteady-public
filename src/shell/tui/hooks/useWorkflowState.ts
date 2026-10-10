/**
 * TUI v1 — useWorkflowState hook.
 *
 * Polls the PID-scoped temp file every 200ms and returns the latest
 * WorkflowState. Falls back to the empty default state when the file
 * is absent or unparseable.
 */

import { useState, useEffect } from "react";
import { readTuiState }        from "../state-bridge.js";
import type { WorkflowState }  from "../types.js";

const EMPTY_STATE: WorkflowState = {
  status:     "Reviewing",
  steps:      [],
  isComplete: false,
};

const POLL_INTERVAL_MS = 200;

export function useWorkflowState(): WorkflowState {
  const [state, setState] = useState<WorkflowState>(EMPTY_STATE);

  useEffect(() => {
    const id = setInterval(() => {
      const next = readTuiState();
      if (next !== null) setState(next);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  return state;
}
