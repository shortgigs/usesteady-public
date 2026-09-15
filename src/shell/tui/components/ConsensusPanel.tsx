/**
 * TUI v2 — ConsensusPanel component.
 *
 * Appears ONLY when ALL conditions are true:
 *   1. status === "Blocked"
 *   2. consensus array is present and non-empty
 *   3. Multi-LLM was active for this task (implied by consensus being set)
 *
 * Hidden entirely otherwise — no placeholder, no empty rows.
 *
 * Exact scope (v2 — intentionally minimal):
 *   Claude:     Accepted
 *   Secondary:  Execution error
 *
 * What is NOT shown here (deferred to v2.1+):
 *   · Round counts
 *   · Normalized hashes
 *   · Rationale codes or internal enums
 *   · Per-round breakdown across multiple rounds
 */

import React        from "react";
import { Box, Text } from "ink";
import type { TuiConsensusEntry } from "../types.js";

type Props = {
  readonly entries: readonly TuiConsensusEntry[] | undefined;
};

const DISPOSITION_COLOR: Record<TuiConsensusEntry["disposition"], string> = {
  "Accepted":        "green",
  "Scope concern":   "yellow",
  "Execution error": "red",
  "Unknown":         "gray",
};

export function ConsensusPanel({ entries }: Props) {
  if (!entries || entries.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={0} marginLeft={2}>
      <Text color="gray" dimColor>Models:</Text>
      {entries.map(entry => (
        <Box key={entry.label} flexDirection="row" marginLeft={2}>
          <Text color="gray">{entry.label.padEnd(14)}</Text>
          <Text color={DISPOSITION_COLOR[entry.disposition]}>{entry.disposition}</Text>
        </Box>
      ))}
    </Box>
  );
}
