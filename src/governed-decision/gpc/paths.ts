/**
 * Org-scoped capsule ledger path (Hybrid D volume).
 * INV-WS-1: derived server-side from sandboxRoot — never from client paths.
 */

import { join } from "node:path";

export const CAPSULE_LEDGER_FILENAME = "capsule-ledger.jsonl";

/** `<sandboxRoot>/capsules/capsule-ledger.jsonl` */
export function capsuleLedgerPathForSandbox(sandboxRoot: string): string {
  const root = sandboxRoot.trim().replace(/[/\\]+$/, "");
  return join(root, "capsules", CAPSULE_LEDGER_FILENAME);
}

/** Ephemeral projections under `<sandboxRoot>/capsules/projections/` */
export function capsuleProjectionsRoot(sandboxRoot: string): string {
  const root = sandboxRoot.trim().replace(/[/\\]+$/, "");
  return join(root, "capsules", "projections");
}
