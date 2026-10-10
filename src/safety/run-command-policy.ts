import { execPath as currentNodeExecutable } from "node:process";

export const RUN_COMMAND_POLICY_REFUSAL_CODE = "command_policy_violation" as const;
export const R0_NODE_VERSION_CAPABILITY_ID = "r0.node.version" as const;

export type RunCommandPolicyResult =
  | {
      readonly ok: true;
      readonly capabilityId: typeof R0_NODE_VERSION_CAPABILITY_ID;
      readonly executable: string;
      readonly args: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: typeof RUN_COMMAND_POLICY_REFUSAL_CODE;
      readonly detail: string;
    };

const NESTED_SHELL_EXECUTABLES = new Set([
  "sh",
  "sh.exe",
  "bash",
  "bash.exe",
  "zsh",
  "zsh.exe",
  "fish",
  "fish.exe",
  "dash",
  "dash.exe",
  "ksh",
  "ksh.exe",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const VERSIONED_SHELL_STEMS = [
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "cmd",
  "powershell",
  "pwsh",
] as const;

function refuse(detail: string): RunCommandPolicyResult {
  return {
    ok: false,
    code: RUN_COMMAND_POLICY_REFUSAL_CODE,
    detail,
  };
}

function executableBasename(executable: string): string {
  const normalized = executable.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return (slash === -1 ? normalized : normalized.slice(slash + 1)).toLowerCase();
}

/**
 * R0 treats an explicit shell token as shell authority even when a launcher
 * such as `env`, `find -exec`, `sudo`, or another wrapper would make that token
 * the eventual executable rather than argv[0] of this process.
 *
 * Exact common names are refused, together with conservative numeric-version
 * spellings such as `bash-5.2`. This remains defense in depth even though the
 * positive R0 authority below is now an exact capability allow-list.
 */
function isExplicitNestedShellToken(token: string): boolean {
  const basename = executableBasename(token);
  if (NESTED_SHELL_EXECUTABLES.has(basename)) return true;

  const withoutExe = basename.endsWith(".exe")
    ? basename.slice(0, -4)
    : basename;

  return VERSIONED_SHELL_STEMS.some((stem) => {
    if (!withoutExe.startsWith(`${stem}-`)) return false;
    const suffix = withoutExe.slice(stem.length + 1);
    return /^\d/u.test(suffix);
  });
}

/**
 * Freeze R0 live run-command authority to explicitly registered capabilities.
 *
 * The command text is a proposal, not process authority. The parser first
 * rejects shell-like syntax, then tokenizes a deliberately tiny literal-argv
 * grammar, and finally maps only an exact registered command shape to an
 * executable identity owned by the running UseSteady process.
 *
 * R0 registers one proof capability only:
 *   `node --version` -> current Node runtime (`process.execPath`) + [`--version`]
 *
 * This intentionally does NOT authorize arbitrary executables, PATH lookup, or
 * arbitrary Node argv. In particular, `node -e`, wrappers, alternate paths,
 * additional argv, and benign-looking commands such as `echo` require a future
 * separately reviewed capability. The returned executable/argv must still be
 * dispatched with `shell: false` by the effect adapter.
 */
export function parseAuthorizedRunCommand(command: string): RunCommandPolicyResult {
  if (command.trim().length === 0) {
    return refuse("Refusing run_command: command is empty.");
  }

  // Public #90-#92 plus #1086/#1092 regression family. These characters either
  // are shell control/expansion syntax or create an ambiguous shell-like
  // program. Refuse them before tokenization; never escape or reinterpret them.
  if (/[\r\n\u0000|><;&`$()]/u.test(command)) {
    return refuse(
      "Refusing run_command: shell control or expansion syntax is not allowed by the R0 capability contract.",
    );
  }

  // R0 intentionally has no escape language. Treating backslash as an escape
  // would reintroduce shell/parser ambiguity; treating it literally would make
  // common shell-authored inputs mean something different. Fail closed.
  if (command.includes("\\")) {
    return refuse(
      "Refusing run_command: backslash escaping is not supported by the R0 capability contract.",
    );
  }

  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | '"' | null = null;

  const flush = (): void => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = "";
    tokenStarted = false;
  };

  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        token += ch;
      }
      tokenStarted = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      tokenStarted = true;
      continue;
    }

    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }

    token += ch;
    tokenStarted = true;
  }

  if (quote !== null) {
    return refuse("Refusing run_command: quoted argument is not terminated.");
  }
  flush();

  if (tokens.length === 0 || tokens[0]!.length === 0) {
    return refuse("Refusing run_command: executable is empty.");
  }

  const nestedShellToken = tokens.find(isExplicitNestedShellToken);
  if (nestedShellToken !== undefined) {
    return refuse(
      `Refusing run_command: explicit nested shell token "${nestedShellToken}" is outside the R0 capability authority.`,
    );
  }

  if (tokens.length === 2 && tokens[0] === "node" && tokens[1] === "--version") {
    return {
      ok: true,
      capabilityId: R0_NODE_VERSION_CAPABILITY_ID,
      executable: currentNodeExecutable,
      args: ["--version"],
    };
  }

  return refuse(
    "Refusing run_command: command shape is not a registered R0 execution capability.",
  );
}
