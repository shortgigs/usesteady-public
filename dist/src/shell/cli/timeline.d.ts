/**
 * usesteady timeline — read-only chronological workflow run view.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * Authority: zero. Reads UCP store via src/history/ only (+ taskInputs peel).
 */
import type { TimelineView } from "../../history/timeline-projection.js";
export type TimelineCommandArgs = {
    readonly mode: "help";
} | {
    readonly mode: "last";
} | {
    readonly mode: "run-id";
    readonly runId: string;
};
export type TimelineOutputFormat = "text" | "json";
/** Advanced override for tests; not advertised in v1 help text. */
export declare function resolveTimelineStoreDir(env?: Readonly<Record<string, string | undefined>>): string;
export declare function parseTimelineArgs(argv: readonly string[]): TimelineCommandArgs | "usage-error";
export declare function buildTimelineView(storeDir: string, args: TimelineCommandArgs): TimelineView;
export type TimelineRunResult = {
    readonly text?: string;
    readonly json?: string;
    readonly exitCode: number;
};
export declare function runTimeline(args: TimelineCommandArgs, storeDir?: string, format?: TimelineOutputFormat): TimelineRunResult;
//# sourceMappingURL=timeline.d.ts.map