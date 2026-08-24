/**
 * Read-only workspace context probe (TUI + portal ContextEnvelope).
 */
import { accessSync, constants, existsSync, lstatSync } from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
export function resolveWorkspaceRootCandidate(rawRoot) {
    const trimmed = rawRoot?.trim();
    if (trimmed !== undefined && trimmed.length === 0) {
        return { ok: false, reason: "missing_root" };
    }
    const candidate = resolvePath(trimmed ?? process.cwd());
    if (!existsSync(candidate)) {
        return { ok: false, reason: "not_found" };
    }
    let stat;
    try {
        stat = lstatSync(candidate);
    }
    catch {
        return { ok: false, reason: "not_found" };
    }
    if (!stat.isDirectory()) {
        return { ok: false, reason: "not_directory" };
    }
    try {
        accessSync(candidate, constants.R_OK);
    }
    catch {
        return { ok: false, reason: "not_readable" };
    }
    const repoDetected = existsSync(join(candidate, ".git"));
    const repoLabel = repoDetected ? basename(candidate) : null;
    const context = {
        workspaceRoot: candidate,
        filesystemReadable: true,
        repoDetected,
        repoLabel,
        capabilities: {
            readFiles: true,
            analyze: true,
            plan: true,
            execute: false,
        },
    };
    return { ok: true, context };
}
//# sourceMappingURL=probe.js.map