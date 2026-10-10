/**
 * Bounded recent-executions list (newest first) from stored evidence only.
 * @see docs/product/executor-execution-timeline-surface-contract-v1.md
 */

import { buildExecutionSummaryProjection } from "./build-execution-summary-projection.js";
import { ObservabilityRejectedError } from "./types.js";
import type {
  BuildRecentExecutionsInput,
  RecentExecutionsProjection,
} from "./types.js";
import { MAX_RECENT_EXECUTIONS_LIMIT } from "./types.js";

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.floor(limit), MAX_RECENT_EXECUTIONS_LIMIT);
}

export function buildRecentExecutionsProjection(
  input: BuildRecentExecutionsInput,
): RecentExecutionsProjection {
  const now = input.now ?? new Date();
  const limit = clampLimit(input.limit);

  const sorted = [...input.bundles].sort((a, b) =>
    b.stored_at.localeCompare(a.stored_at),
  );

  const truncated = sorted.length > limit;
  const slice = sorted.slice(0, limit);

  const items = [];
  for (const bundle of slice) {
    try {
      items.push(
        buildExecutionSummaryProjection({
          worker_result: bundle.worker_result,
          stored_at:     bundle.stored_at,
          now,
        }),
      );
    } catch (err) {
      if (err instanceof ObservabilityRejectedError) {
        continue;
      }
      throw err;
    }
  }

  return {
    list_id:      `recent-${now.getTime()}`,
    generated_at: now.toISOString(),
    items,
    limit,
    truncated,
  };
}
