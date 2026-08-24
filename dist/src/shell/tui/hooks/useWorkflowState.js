/**
 * TUI v1 — useWorkflowState hook.
 *
 * Polls the PID-scoped temp file every 200ms and returns the latest
 * WorkflowState. Falls back to the empty default state when the file
 * is absent or unparseable.
 */
import { useState, useEffect } from "react";
import { readTuiState } from "../state-bridge.js";
const EMPTY_STATE = {
    status: "Reviewing",
    steps: [],
    isComplete: false,
};
const POLL_INTERVAL_MS = 200;
export function useWorkflowState() {
    const [state, setState] = useState(EMPTY_STATE);
    useEffect(() => {
        const id = setInterval(() => {
            const next = readTuiState();
            if (next !== null)
                setState(next);
        }, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);
    return state;
}
//# sourceMappingURL=useWorkflowState.js.map