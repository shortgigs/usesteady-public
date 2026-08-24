import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
const DIVIDER = "─".repeat(48);
export function BlockedReasonPanel({ reason }) {
    if (!reason)
        return null;
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsxs(Text, { color: "gray", children: ["  ", DIVIDER] }), _jsxs(Text, { bold: true, color: "red", children: ["  ", "\u274C Blocked"] }), _jsxs(Text, { color: "gray", children: ["  ", "Reason: ", _jsx(Text, { color: "white", children: reason })] }), _jsxs(Text, { color: "gray", children: ["  ", DIVIDER] })] }));
}
//# sourceMappingURL=BlockedReasonPanel.js.map