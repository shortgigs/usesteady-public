import type { WorkflowTerminalRecord } from "./workflow-terminal.js";
export type WorkflowTerminalFileRecord = WorkflowTerminalRecord & {
    runToken?: string;
};
export type WorkflowOutcomeReadResult = {
    ok: true;
    record: WorkflowTerminalRecord;
} | {
    ok: false;
    error: "missing" | "malformed" | "token_mismatch";
};
export declare function readWorkflowTerminalOutcomeStrict(outcomePath: string, expectedRunToken: string): Promise<WorkflowOutcomeReadResult>;
//# sourceMappingURL=workflow-outcome-file.d.ts.map