export async function readWorkflowTerminalOutcomeStrict(outcomePath, expectedRunToken) {
    try {
        const { existsSync, readFileSync, rmSync } = await import("node:fs");
        if (!existsSync(outcomePath))
            return { ok: false, error: "missing" };
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(outcomePath, "utf8"));
        }
        catch {
            rmSync(outcomePath, { force: true });
            return { ok: false, error: "malformed" };
        }
        rmSync(outcomePath, { force: true });
        if (!parsed || typeof parsed !== "object")
            return { ok: false, error: "malformed" };
        const data = parsed;
        const outcome = data.outcome;
        if (outcome !== "completed" &&
            outcome !== "stopped_by_user" &&
            outcome !== "failed_explicit") {
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
    }
    catch {
        return { ok: false, error: "malformed" };
    }
}
//# sourceMappingURL=workflow-outcome-file.js.map