/**
 * Converts WorkflowSpec tasks into ExecutionStep[] for SYSTEM WILL preview.
 * Shared by server.ts (execution review panel) and CLI `usesteady plan`.
 */
import { randomUUID } from "node:crypto";
import { ancestorClosure, formatAncestorDirs, CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE, } from "../workflow/effect-closure.js";
/**
 * CREATE_DIR_EFFECT_CONTRACT_V1 pre-approval disclosure
 * (docs/product/CREATE_DIR_EFFECT_CONTRACT_V1.md §3-4). The set is derived ONLY
 * from the hash-bound target via the single shared ancestorClosure. Returns
 * null when there are no ancestors to disclose; generic text (fail-closed)
 * when the closure is underivable.
 */
function createDirAncestorDisclosure(target, workspaceRoot) {
    const closure = ancestorClosure(target, workspaceRoot);
    if (closure === null)
        return `${CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE}.`;
    const ancestors = closure.slice(0, -1);
    if (ancestors.length === 0)
        return null;
    return `May also create missing ancestor directories: ${formatAncestorDirs(ancestors)} — only inside this workspace, only if they do not already exist.`;
}
const HIGH_RISK_PATTERNS = [
    /\.env$/i, /\.env\./i,
    /tsconfig/i, /package\.json$/i, /package-lock\.json$/i,
    /\.config\.(ts|js|mjs|cjs)$/i,
    /vite\.config/i, /webpack\.config/i,
    /Dockerfile$/i, /docker-compose/i,
    /\.github\//i, /\.gitignore$/i,
];
function isHighRiskFile(path) {
    return HIGH_RISK_PATTERNS.some(re => re.test(path));
}
function isTestFile(path) {
    return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path) || /\/__tests__\//.test(path);
}
function isStyleOnly(path) {
    return /\.(css|scss|sass|less|styl)$/i.test(path);
}
const SHARED_LOGIC_PATTERNS = [
    /\/index\.(ts|tsx|js|jsx)$/i,
    /use[A-Z][a-zA-Z]+\.(ts|tsx)$/,
    /(Provider|Context|Store|Reducer|Slice)\.(ts|tsx)$/i,
    /(Service|Adapter|Client|Manager|Middleware|Repository)\.(ts|tsx)$/i,
];
function isSharedLogicFile(path) {
    return SHARED_LOGIC_PATTERNS.some(re => re.test(path));
}
function isCosmeticInput(input) {
    return /\b(colour|color|text|copy|label|placeholder|spacing|margin|padding|font|style)\b/i.test(input);
}
function isRuntimeConfigFile(path) {
    return /(?:^|\/)config\.(ts|tsx|js|jsx|mjs)$/i.test(path);
}
function inferConfigModule(filePath) {
    const parts = filePath.replace(/\\/g, "/").split("/");
    const configIdx = parts.findIndex(p => /^config\./i.test(p));
    if (configIdx > 0)
        return parts[configIdx - 1];
    return "this";
}
function derivedRisk(op, files, task) {
    if (op === "delete_file")
        return "high";
    if (files.some(isHighRiskFile))
        return "high";
    if (op === "rename" || files.length > 3)
        return "medium";
    if (files.every(isTestFile) && files.length > 0)
        return "low";
    if (files.every(isStyleOnly) && files.length > 0)
        return "low";
    if (task && isCosmeticInput(task.input))
        return "low";
    if ((op === "replace" || op === undefined) && files.some(isRuntimeConfigFile))
        return "medium";
    if ((op === "replace" || op === undefined) && files.some(isSharedLogicFile))
        return "medium";
    if (files.some(f => /\.(tsx|jsx)$/.test(f)))
        return "medium";
    return "low";
}
function derivedSummary(op, task, files) {
    const fileList = files.length === 1 ? files[0] :
        files.length > 1 ? `${files.length} files` :
            "workspace";
    switch (op) {
        case "write_file": return `Create new file: ${fileList}`;
        case "create_dir": return `Create directory: ${fileList}`;
        case "delete_file": return `Permanently delete: ${fileList}`;
        case "rename": return `Rename ${files[0] ?? "file"} → ${task.newPath ?? "new path"}`;
        case "replace": return files.some(isRuntimeConfigFile)
            ? `Update configuration value in: ${fileList}`
            : `Apply text replacement in: ${fileList}`;
        case "append_file": return `Append content to: ${fileList}`;
        case "prepend_file": return `Prepend content to: ${fileList}`;
        case "run_command": return task.command
            ? `Run command: ${task.command}`
            : `Run command`;
        default:
            return files.length > 0
                ? `Modify ${fileList} to fulfil: "${task.input}"`
                : `AI runtime will determine changes for: "${task.input}"`;
    }
}
function inferDeleteConsequences(filePath) {
    const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
    const name = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
    const lines = [];
    if (/index/i.test(name)) {
        lines.push(`Removes the barrel/index file — re-exports from this module will break`);
    }
    else if (/provider|context/i.test(name)) {
        lines.push(`Removes ${name} — any component consuming this context will error at runtime`);
    }
    else if (/hook|use[A-Z]/i.test(name)) {
        lines.push(`Removes ${name} hook — all call sites will break at build time`);
    }
    else if (/store|reducer|slice/i.test(name)) {
        lines.push(`Removes ${name} state module — any connected component will break`);
    }
    else if (/service|adapter|client/i.test(name)) {
        lines.push(`Removes ${name} — callers of this service will fail at runtime`);
    }
    else if (/util|helper|lib/i.test(name)) {
        lines.push(`Removes shared utilities in ${name} — any direct import will break at build time`);
    }
    else if (/test|spec/i.test(name)) {
        lines.push(`Removes test file ${base} — no production code is affected`);
    }
    else if (/deprecated|legacy|old|unused/i.test(name)) {
        lines.push(`Removes ${base} — verify no code still imports from it before approving`);
    }
    else {
        lines.push(`Removes ${base} and all its exports`);
    }
    lines.push(`Any import of this file will fail immediately after deletion`);
    lines.push(`No automatic recovery — requires git revert if this was a mistake`);
    return lines;
}
function derivedChanges(op, task, files) {
    if (files.length === 0) {
        return [{ file: "Determined at runtime", details: "The AI will identify the exact target files during execution." }];
    }
    if (op === "delete_file") {
        return files.map(f => ({
            file: f,
            details: inferDeleteConsequences(f).join(" · "),
        }));
    }
    return files.map(f => {
        const detail = op === "write_file" ? (task.content ? `Write ${task.content.split("\n").length} lines` : "Write new content") :
            op === "create_dir" ? "Create directory" :
                op === "rename" ? `Rename to ${task.newPath ?? "new path"}` :
                    op === "replace" ? (isRuntimeConfigFile(f)
                        ? `Modifies configuration values — ${inferConfigModule(f)} module runtime behavior will change`
                        : "Apply text replacement (exact diff at execution time)") :
                        "Apply AI-generated changes";
        return { file: f, details: detail };
    });
}
function derivedImpact(op, files, workspaceRoot) {
    const impact = [];
    if (op === "delete_file") {
        impact.push("File is permanently removed — recovery requires version control.");
        if (files.some(f => !isTestFile(f))) {
            impact.push("Any code importing from this file will break.");
        }
    }
    else if (op === "rename") {
        impact.push("All import statements referencing the old path will need updating.");
        impact.push("IDE and bundler caches may need clearing after rename.");
    }
    else if (op === "write_file") {
        impact.push("New file added to workspace — no existing behaviour is changed.");
    }
    else if (op === "create_dir") {
        impact.push("New directory created — no existing code is affected.");
        // CREATE_DIR_EFFECT_CONTRACT_V1 §3 — load-bearing pre-approval disclosure.
        const disclosure = files.length > 0
            ? createDirAncestorDisclosure(files[0], workspaceRoot)
            : null;
        if (disclosure !== null)
            impact.push(disclosure);
    }
    else if (op === "replace") {
        if (files.some(isRuntimeConfigFile)) {
            impact.push("Configuration change — affects runtime behavior when the module next loads.");
            impact.push("No diff preview before execution — verify the intended value in the task description.");
        }
        else if (files.length > 1) {
            impact.push(`Change applied across ${files.length} files — verify all occurrences are intentional.`);
        }
        else {
            impact.push("In-place text replacement — review exact diff before approving.");
        }
    }
    else {
        if (files.length > 1)
            impact.push(`${files.length} files will be modified.`);
        impact.push("AI determines exact changes at runtime — review the generated diff carefully.");
    }
    if (files.some(isHighRiskFile)) {
        impact.push("⚠ Affects a configuration or dependency file — changes may affect the entire project.");
    }
    return impact;
}
function derivedRiskNotes(op, task, files) {
    const notes = [];
    if (op === "delete_file")
        notes.push("Check git status before approving — deletion cannot be undone without VCS.");
    if (op === "rename")
        notes.push(`Verify no hard-coded references to the old path exist outside of ${files[0] ?? "this file"}.`);
    if (files.some(isHighRiskFile))
        notes.push("This file type is commonly shared across environments — changes may have wide blast radius.");
    if ((op === "replace" || op === undefined) && files.some(isRuntimeConfigFile)) {
        notes.push(`Configuration values in ${files.filter(isRuntimeConfigFile).map(f => inferConfigModule(f)).join(", ")} module` +
            " control runtime behavior — the exact characters being changed are only visible at execution time.");
    }
    if (files.length > 3)
        notes.push("Large number of affected files — consider reviewing each file individually.");
    return notes;
}
function derivedWhy(op, task, files, workspaceRoot) {
    const intent = `You asked: "${task.input}"`;
    // CREATE_DIR_EFFECT_CONTRACT_V1 §3 — the closure is approved with the target;
    // that authority semantics must be visible, not implicit.
    const createDirSuffix = (() => {
        if (op !== "create_dir" || files.length === 0)
            return "";
        const closure = ancestorClosure(files[0], workspaceRoot);
        if (closure === null) {
            return " Missing ancestor directories within the authorized scope may also be created.";
        }
        const ancestors = closure.slice(0, -1);
        if (ancestors.length === 0)
            return "";
        return ` Approving this step also approves creation of these missing ancestors: ${formatAncestorDirs(ancestors)}.`;
    })();
    const consequence = op === "delete_file" ? (`The system will permanently delete ${files.join(", ")}.\n\n` +
        inferDeleteConsequences(files[0] ?? "").map(l => `• ${l}`).join("\n")) :
        op === "rename" ? `The system will rename ${files[0] ?? "the file"} to ${task.newPath ?? "the new path"}. Import paths will not be updated automatically.` :
            op === "create_dir" ? `The system will create the directory ${files.join(", ") || "at the path shown above"}. No files inside it are modified unless a later step says so.${createDirSuffix}` :
                op === "write_file" ? `The system will create ${files[0] ?? "a new file"} with the specified content.` :
                    op === "replace" ? (files.some(isRuntimeConfigFile)
                        ? `The system will modify configuration values in ${files.join(", ")} to address: "${task.input}".\n\n` +
                            `This changes how the ${inferConfigModule(files[0] ?? "")} module behaves at runtime. ` +
                            `The exact values written are applied at execution time — what is described in your request is what will change.`
                        : `The system will apply a text replacement inside ${files.join(", ")} — the exact characters changed are determined at execution time.`) :
                        files.length > 0
                            ? `The system will apply AI-generated changes to ${files.join(", ")} to fulfil your intent.`
                            : "The AI runtime will determine which files to change and how.";
    return `${intent}\n\n${consequence}`;
}
/** Derive execution-review steps from a workflow spec (read-only preview). */
export function specToExecutionSteps(spec, workspaceRoot) {
    return spec.tasks.map(task => {
        const op = task.operationType;
        const files = (task.targetFiles ?? []);
        const effectiveFiles = files.length > 0 ? files : (() => {
            if (!task.input)
                return [];
            const createFolder = task.input.match(/\b(?:create\s+folder|mkdir)\s+([\w./\\-]+)/i);
            if (createFolder?.[1])
                return [createFolder[1].replace(/\/$/, "")];
            const createFile = task.input.match(/\bcreate\s+file\s+([\w./\\-]+\.[a-zA-Z0-9]+)/i);
            if (createFile?.[1])
                return [createFile[1]];
            const inMatch = task.input.match(/\bin\s+([\w./\\-]+\.[a-zA-Z]{1,5})\s*$/i);
            if (inMatch?.[1])
                return [inMatch[1]];
            const verbMatch = task.input.match(/\b(?:delete|remove|create|write|update|rename)\s+([\w./\\-]+\.[a-zA-Z]{1,5})\b/i);
            if (verbMatch?.[1])
                return [verbMatch[1]];
            const bareMatch = task.input.match(/([\w./\\-]+\.(?:tsx?|jsx?|mjs?|css|json|ya?ml|sh|py|rb|go|rs))\b/i);
            return bareMatch?.[1] ? [bareMatch[1]] : [];
        })();
        const inferredOp = op ?? (() => {
            if (!task.input)
                return undefined;
            const lc = task.input.toLowerCase().trimStart();
            if (/^(?:delete|remove)\b/.test(lc))
                return "delete_file";
            if (/^(?:rename|move)\b/.test(lc))
                return "rename";
            if (/^(?:mkdir|create\s+(?:folder|directory|dir))\b/.test(lc))
                return "create_dir";
            if (/^create\s+file\b/.test(lc))
                return "write_file";
            if (/^(?:create|add\s+file|write\s+file)\b/.test(lc))
                return "write_file";
            return undefined;
        })();
        const actionType = inferredOp === "create_dir" || inferredOp === "write_file" ? "create" :
            inferredOp === "rename" ? "rename" :
                inferredOp === "delete_file" ? "delete" :
                    "update";
        return {
            id: randomUUID(),
            file_path: effectiveFiles[0] ?? files[0] ?? workspaceRoot,
            action_type: actionType,
            system_will: {
                summary: derivedSummary(inferredOp, task, effectiveFiles),
                changes: derivedChanges(inferredOp, task, effectiveFiles),
                impact: derivedImpact(inferredOp, effectiveFiles, workspaceRoot),
                risk_notes: derivedRiskNotes(inferredOp, task, effectiveFiles),
            },
            risk_level: derivedRisk(inferredOp, effectiveFiles, task),
            why_explanation: derivedWhy(inferredOp, task, effectiveFiles, workspaceRoot),
            status: "pending",
        };
    });
}
//# sourceMappingURL=spec-to-execution-steps.js.map