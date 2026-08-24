import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
function symbol(step, isCurrent) {
    if (isCurrent && step.status === "pending")
        return "→";
    switch (step.status) {
        case "completed": return "✓";
        case "failed": return "✗";
        case "blocked": return "✗";
        case "pending": return "·";
        case "planning_reviewed": return "-";
    }
}
function color(step, isCurrent) {
    if (isCurrent && step.status === "pending")
        return "yellow";
    switch (step.status) {
        case "completed": return "green";
        case "failed": return "red";
        case "blocked": return "red";
        case "pending": return "gray";
        case "planning_reviewed": return "white";
    }
}
export function StepList({ steps, currentStepId }) {
    if (steps.length === 0)
        return null;
    return (_jsx(Box, { flexDirection: "column", children: steps.map(step => {
            const isCurrent = step.id === currentStepId;
            const sym = symbol(step, isCurrent);
            const col = color(step, isCurrent);
            const num = String(step.id + 1).padStart(2, " ");
            return (_jsx(Box, { children: _jsxs(Text, { color: col, children: ["  ", "[", num, "] ", sym, "  ", step.description] }) }, step.id));
        }) }));
}
//# sourceMappingURL=StepList.js.map