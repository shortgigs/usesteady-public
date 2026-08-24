import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { StepList } from "./StepList.js";
import { SystemWillPanel } from "./SystemWillPanel.js";
import { BlockedReasonPanel } from "./BlockedReasonPanel.js";
import { ConsensusPanel } from "./ConsensusPanel.js";
import { useWorkflowState } from "../hooks/useWorkflowState.js";
function statusColor(status) {
    switch (status) {
        case "Reviewing": return "blue";
        case "Executing": return "yellow";
        case "Blocked": return "red";
        case "Completed": return "green";
        case "Stopped": return "gray";
    }
}
export function WorkflowView() {
    const state = useWorkflowState();
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, marginBottom: 1, children: [_jsxs(Box, { justifyContent: "space-between", children: [_jsxs(Box, { children: [_jsxs(Text, { dimColor: true, children: ["  ", "UseSteady  "] }), _jsx(Text, { bold: true, color: statusColor(state.status), children: state.status })] }), _jsx(Text, { dimColor: true, children: "  execution monitor \u2014 read only  " })] }), _jsx(Box, { marginTop: 1, children: _jsx(StepList, { steps: state.steps, currentStepId: state.currentStepId }) }), _jsx(SystemWillPanel, { description: state.systemWill?.description }), _jsx(BlockedReasonPanel, { reason: state.blockedReason }), _jsx(ConsensusPanel, { entries: state.consensus })] }));
}
//# sourceMappingURL=WorkflowView.js.map