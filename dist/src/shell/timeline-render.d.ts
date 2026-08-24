/**
 * Timeline shell rendering — pure text + JSON projection.
 *
 * Design lock: docs/product/usesteady-timeline-design-v1.md
 * v1.1 lock: docs/product/usesteady-timeline-v1_1-design-v1.md
 * No I/O. No store reads. No authority.
 */
import type { TimelineView } from "../history/timeline-projection.js";
export declare const TIMELINE_DISCLAIMER_LINES: readonly ["Timeline is a read-only audit view. It does not execute steps, approve changes,", "resume workflows, or replay artifacts. Passing display does not grant permission", "to run anything without your explicit approval."];
/** K7-I4: test-enforced forbidden JSON keys for timeline output. */
export declare const TIMELINE_FORBIDDEN_JSON_KEYS: readonly ["actions", "resume", "resumable", "continue", "canResume", "resumeToken", "nextStep", "nextTaskIndex", "progress", "percentComplete", "currentTaskIndex", "completedTaskCount", "executionSessionId", "suggestedAction", "safeToExecute", "approved", "liveRun", "phase", "runTimeline", "intentChains"];
export declare function renderTimelineIncompleteText(runId: string): string;
export declare function renderTimelineText(view: TimelineView): string;
export declare function renderTimelineJson(view: TimelineView): string;
export declare function renderTimelineHelpText(): string;
//# sourceMappingURL=timeline-render.d.ts.map