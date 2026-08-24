import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
const DISPOSITION_COLOR = {
    "Accepted": "green",
    "Scope concern": "yellow",
    "Execution error": "red",
    "Unknown": "gray",
};
export function ConsensusPanel({ entries }) {
    if (!entries || entries.length === 0)
        return null;
    return (_jsxs(Box, { flexDirection: "column", marginTop: 0, marginLeft: 2, children: [_jsx(Text, { color: "gray", dimColor: true, children: "Models:" }), entries.map(entry => (_jsxs(Box, { flexDirection: "row", marginLeft: 2, children: [_jsx(Text, { color: "gray", children: entry.label.padEnd(14) }), _jsx(Text, { color: DISPOSITION_COLOR[entry.disposition], children: entry.disposition })] }, entry.label)))] }));
}
//# sourceMappingURL=ConsensusPanel.js.map