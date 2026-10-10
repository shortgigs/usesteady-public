/**
 * Stable Zod schemas for governed-decision CLI `--json` responses (schemaVersion 1.0).
 *
 * Used by contract tests and future MCP tools. Runtime CLI emits objects matching
 * these shapes; validation is test-side only (no zod in the hot path).
 */

import { z } from "zod";

export const UseSteadyCLIResponse = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    schemaVersion: z.literal("1.0"),
    command: z.enum(["decide", "ratify", "show", "lineage", "decisions"]),
    status: z.enum([
      "success",
      "draft",
      "awaiting_ratification",
      "needs_input",
      "error",
    ]),
    recordId: z.string().nullable().optional(),
    timestamp: z.string().datetime(),
    data: dataSchema.nullable(),
    message: z.string().optional(),
    nextSteps: z.array(z.string()).optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .optional(),
    certification: z
      .object({
        status: z.enum(["unknown", "connected", "verified"]),
        source: z.enum(["local", "portal"]).optional(),
      })
      .optional(),
  });

export const ElicitationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(["text", "boolean", "select", "number"]),
  default: z.unknown().optional(),
  options: z.array(z.unknown()).optional(),
});

export const ReferenceRefSchema = z.object({
  kind: z.string(),
  ref: z.string(),
  description: z.string().optional(),
});

export const DecideProjectionSchema = z.object({
  summary: z.string(),
  filesToChange: z.array(z.string()),
  estimatedImpact: z.enum(["low", "medium", "high"]).optional(),
  SYSTEM_WILL: z.string().optional(),
});

export const DecideDataSchema = z.object({
  goal: z.string(),
  projection: DecideProjectionSchema,
  elicitation: z.array(ElicitationQuestionSchema).nullable(),
  refs: z.array(ReferenceRefSchema).optional(),
});

export const RatifyDataSchema = z.object({
  previousStatus: z.string(),
  newStatus: z.string(),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  executionPath: z.enum(["local", "portal", "camunda"]).optional(),
});

export const ShowDataSchema = z.object({
  record: z.unknown(),
  projection: z.unknown(),
});

export const DecisionsListItemSchema = z.object({
  threadId: z.string(),
  draftRecordId: z.string().nullable(),
  finalRecordId: z.string().nullable(),
  ratifiedDecision: z.string().nullable(),
  goal: z.string(),
});

export const DecisionsDataSchema = z.object({
  threads: z.array(DecisionsListItemSchema),
});

export const LineageDataSchema = z.object({
  root: z.string(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  certification: z
    .object({
      status: z.enum(["unknown", "connected", "verified"]),
      source: z.enum(["local", "portal"]).optional(),
    })
    .optional(),
});

export const DecideResponseSchema = UseSteadyCLIResponse(DecideDataSchema);
export const RatifyResponseSchema = UseSteadyCLIResponse(RatifyDataSchema);
export const ShowResponseSchema = UseSteadyCLIResponse(ShowDataSchema);
export const LineageResponseSchema = UseSteadyCLIResponse(LineageDataSchema);
export const DecisionsResponseSchema = UseSteadyCLIResponse(DecisionsDataSchema);

export type UseSteadyCLIResponseShape<T> = {
  schemaVersion: "1.0";
  command: "decide" | "ratify" | "show" | "lineage" | "decisions";
  status: "success" | "draft" | "awaiting_ratification" | "needs_input" | "error";
  recordId?: string | null;
  timestamp: string;
  data: T | null;
  message?: string;
  nextSteps?: string[];
  error?: { code: string; message: string; details?: unknown };
  certification?: {
    status: "unknown" | "connected" | "verified";
    source?: "local" | "portal";
  };
};
