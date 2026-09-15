/**
 * TUI v1 — SystemWillPanel component.
 *
 * Renders only when systemWill is present.
 * Hidden entirely when absent — no placeholder, no empty box.
 */

import React        from "react";
import { Box, Text } from "ink";

const DIVIDER = "─".repeat(48);

type Props = {
  readonly description: string | undefined;
};

export function SystemWillPanel({ description }: Props) {
  if (!description) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray">{"  "}{DIVIDER}</Text>
      <Text bold color="white">{"  "}SYSTEM WILL</Text>
      <Text color="cyan">{"  → "}{description}</Text>
      <Text color="gray">{"  "}{DIVIDER}</Text>
    </Box>
  );
}
