const PATTERNS = [
    // Shell invocation — direct or via /bin/ prefix
    { regex: /\brun\s+bash\b/i, label: "run bash" },
    { regex: /\/(?:usr\/)?bin\/(?:bash|sh|zsh|fish|ksh|csh|dash)(?:\s|$)/i, label: "shell invocation (/bin/)" },
    // Pipe to a shell interpreter (wget/curl/cat piped to bash/sh/etc.)
    { regex: /\bcurl\b.*\|/i, label: "curl | (pipe)" },
    { regex: /\bwget\b.*\|/i, label: "wget | (pipe)" },
    { regex: /\|\s*(?:bash|sh|zsh|fish|ksh|csh|dash)\b/i, label: "pipe to shell" },
    // Inline code execution via interpreter flags
    { regex: /\bpython\d*\s+-[Eec]\b/i, label: "python -c (inline code)" },
    { regex: /\bnode\s+-e\b/i, label: "node -e (inline code)" },
    { regex: /\bsh\s+-c\b/i, label: "sh -c" },
    // Windows shell with command execution
    { regex: /\bcmd(?:\.exe)?\s+\/[cCkK]\b/i, label: "cmd /c" },
    { regex: /\bpowershell(?:\.exe)?\s+-(?:Command|[cC])\b/i, label: "powershell -Command" },
    // Backtick command substitution
    { regex: /`[^`\n]+`/, label: "backtick substitution" },
    // Other shell patterns
    { regex: /\bexecute\s+(?:this\s+|a\s+|an?\s+)?shell\b/i, label: "execute shell" },
    { regex: /\beval\s*\(/i, label: "eval()" },
    // Privilege escalation — never safe to run via UseSteady
    { regex: /\bsudo\b/i, label: "sudo" },
    { regex: /\bsu\s+-\b/i, label: "su -" },
    { regex: /\bdoas\b/i, label: "doas" },
    { regex: /\brunas\b/i, label: "runas" },
];
function findMatch(input) {
    return PATTERNS.find(({ regex }) => regex.test(input)) ?? null;
}
export const arbitraryExecDetector = {
    id: "arbitrary_script_execution",
    priority: 40,
    supports(input) {
        return findMatch(input) !== null;
    },
    detect(input) {
        const match = findMatch(input);
        if (match === null)
            return null;
        return {
            verdict: "block",
            reason: "arbitrary_script_execution",
            matchedPattern: match.label,
            note: "Input contains a pattern associated with arbitrary script or shell execution.",
        };
    },
};
//# sourceMappingURL=arbitrary-exec.detector.js.map