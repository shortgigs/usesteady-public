import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveStoreDir } from "../shell/defaults.js";

/**
 * Presence-attribution failure sink (S2).
 *
 * Records the single event that matters for the certified presence-attribution
 * property: a present fact rendered to a human with NO derivable attribution
 * span -- a real-traffic violation of PMC-A/PMC-C. It is the tripwire that turns
 * a re-runnable certificate into a continuously observed one.
 *
 * Posture (inviolable, per the charter):
 *   - write-only, append-only (one JSON line per event)
 *   - ZERO authority: never blocks, gates, routes, or alters any decision
 *   - certification EVIDENCE, not product telemetry: no dashboards, rankings,
 *     optimization, learning, or feedback into any decision path
 *   - best-effort: never throws
 *
 * The record lands as `presence-attribution-failures.jsonl` in the resolved
 * store dir. A human reviewing the certification reads it; nothing else does.
 *
 * Governed by USESTEADY_PRESENCE_ATTRIBUTION_UI_IMPLEMENTATION_V1.
 */

export type UnattributedPresenceFact = {
  readonly input: string;
  readonly field: string;
  readonly fact: string;
  readonly step?: number;
};

export function recordUnattributedPresenceFact(rec: UnattributedPresenceFact): void {
  try {
    const dir = resolveStoreDir();
    mkdirSync(dir, { recursive: true });
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n";
    appendFileSync(join(dir, "presence-attribution-failures.jsonl"), line, "utf8");
  } catch {
    // best-effort, write-only, zero authority: never propagate a sink failure
  }
}
