import { jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
const DIVIDER = "─".repeat(48);
export function SystemWillPanel({ description }) {
    if (!description)
        return null;
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsxs(Text, { color: "gray", children: ["  ", DIVIDER] }), _jsxs(Text, { bold: true, color: "white", children: ["  ", "SYSTEM WILL"] }), _jsxs(Text, { color: "cyan", children: ["  → ", description] }), _jsxs(Text, { color: "gray", children: ["  ", DIVIDER] })] }));
}
//# sourceMappingURL=SystemWillPanel.js.map