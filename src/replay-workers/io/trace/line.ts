/**
 * Trace line validation — single line only; no rewrite/truncate/delete/replace.
 */

import { REPLAY_NAMESPACE_TRACE_LINE_MESSAGE_MAX } from "./constants.js";
import type { ReplayNamespaceTraceLinePayload } from "./types.js";

export type TraceLineValidation =
  | { readonly ok: true; readonly line: ReplayNamespaceTraceLinePayload }
  | { readonly ok: false; readonly cause: string; readonly reason: string };

const FORBIDDEN_TRACE_LINE_KEYS = [
  "rewrite",
  "truncate",
  "delete",
  "replace",
  "trace_lines",
  "lines",
  "multi_line",
  "overwrite",
] as const;

export function validateTraceLine(raw: unknown): TraceLineValidation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok:     false,
      cause:  "trace_line_invalid",
      reason: "trace_line must be a plain object.",
    };
  }

  const record = raw as Record<string, unknown>;

  for (const key of FORBIDDEN_TRACE_LINE_KEYS) {
    if (key in record) {
      return {
        ok:     false,
        cause:  `trace_${key}_forbidden`,
        reason: `trace_line must not include "${key}" — single-line append only.`,
      };
    }
  }

  const line_kind = record["line_kind"];
  if (line_kind !== "replay_namespace_trace_line") {
    return {
      ok:     false,
      cause:  "trace_line_kind_invalid",
      reason: 'trace_line.line_kind must be "replay_namespace_trace_line".',
    };
  }

  const message = record["message"];
  if (typeof message !== "string" || message.trim().length === 0) {
    return {
      ok:     false,
      cause:  "trace_line_message_missing",
      reason: "trace_line.message is required.",
    };
  }

  if (message.includes("\n") || message.includes("\r")) {
    return {
      ok:     false,
      cause:  "trace_multiline_forbidden",
      reason: "Multi-line trace append is not permitted — exactly one line per request.",
    };
  }

  if (message.length > REPLAY_NAMESPACE_TRACE_LINE_MESSAGE_MAX) {
    return {
      ok:     false,
      cause:  "trace_line_message_too_long",
      reason: `trace_line.message exceeds max length ${REPLAY_NAMESPACE_TRACE_LINE_MESSAGE_MAX}.`,
    };
  }

  const recorded_at = record["recorded_at"];
  if (
    recorded_at !== undefined &&
    (typeof recorded_at !== "string" || recorded_at.trim().length === 0)
  ) {
    return {
      ok:     false,
      cause:  "trace_line_recorded_at_invalid",
      reason: "trace_line.recorded_at must be a non-empty ISO string when provided.",
    };
  }

  const line: ReplayNamespaceTraceLinePayload = {
    line_kind: "replay_namespace_trace_line",
    message:   message.trim(),
    ...(typeof recorded_at === "string"
      ? { recorded_at: recorded_at.trim() }
      : {}),
  };

  return { ok: true, line };
}
