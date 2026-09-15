import type { WorkflowTerminalRecord } from "./workflow-terminal.js";

export type WorkflowTerminalFileRecord = WorkflowTerminalRecord & {
  runToken?: string;
};

export type WorkflowOutcomeReadResult =
  | { ok: true; record: WorkflowTerminalRecord }
  | { ok: false; error: "missing" | "malformed" | "token_mismatch" };

export async function readWorkflowTerminalOutcomeStrict(
  outcomePath: string,
  expectedRunToken: string,
): Promise<WorkflowOutcomeReadResult> {
  try {
    const { existsSync, readFileSync, rmSync } = await import("node:fs");
    if (!existsSync(outcomePath)) return { ok: false, error: "missing" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(outcomePath, "utf8"));
    } catch {
      rmSync(outcomePath, { force: true });
      return { ok: false, error: "malformed" };
    }
    rmSync(outcomePath, { force: true });

    if (!parsed || typeof parsed !== "object") return { ok: false, error: "malformed" };
    const data = parsed as Partial<WorkflowTerminalFileRecord>;
    const outcome = data.outcome;
    if (
      outcome !== "completed" &&
      outcome !== "stopped_by_user" &&
      outcome !== "failed_explicit"
    ) {
      return { ok: false, error: "malformed" };
    }
    if (typeof data.exitCode !== "number" || typeof data.message !== "string") {
      return { ok: false, error: "malformed" };
    }
    if (data.runToken !== expectedRunToken) {
      return { ok: false, error: "token_mismatch" };
    }
    return {
      ok: true,
      record: {
        outcome,
        exitCode: data.exitCode,
        message: data.message,
      },
    };
  } catch {
    return { ok: false, error: "malformed" };
  }
}
