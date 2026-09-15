/**
 * TUI v1.1 — BlockedReasonPanel component.
 *
 * Appears ONLY when status === "Blocked" and blockedReason is set.
 * Hidden entirely otherwise — no placeholder, no empty box.
 *
 * Scope (intentionally minimal):
 *   ❌ Blocked
 *   Reason: <short human-readable text>
 *
 * What is NOT shown here (deferred to ConsensusPanel v2):
 *   · Model-by-model breakdown
 *   · Audit-level details
 *   · Round counts or hashes
 */

import React        from "react";
import { Box, Text } from "ink";

const DIVIDER = "─".repeat(48);

type Props = {
  readonly reason: string | undefined;
};

export function BlockedReasonPanel({ reason }: Props) {
  if (!reason) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">{"  "}{DIVIDER}</Text>
      <Text bold color="red">{"  "}❌ Blocked</Text>
      <Text color="gray">{"  "}Reason: <Text color="white">{reason}</Text></Text>
      <Text color="gray">{"  "}{DIVIDER}</Text>
    </Box>
  );
}
