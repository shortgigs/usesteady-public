#!/usr/bin/env tsx
/**
 * usesteady — CLI entry point.
 *
 * Input source contract (deterministic):
 *   Exactly one direct input source is allowed per invocation:
 *     --prompt "..."
 *     --json "..."
 *     piped stdin
 *   Mixed direct sources fail explicitly.
 *
 * Dispatch order after source validation:
 *   1. direct source path (prompt/json/stdin)
 *   2. positional argv request
 *   3. interactive session / known subcommands
 *
 * Execution modes:
 *   interactive   readline loop, TTY required
 *   run           usesteady run spec.json --yes  — zero prompts, CI-safe
 *   draft         usesteady "rename X to Y"      — preview then approve
 *   json          usesteady --json '{...}' --yes — structured, machine-readable
 *   batch         usesteady batch ops.json --yes — JSON array, same execution path
 *
 * Flags (global, stripped before subcommand parsing):
 *   --prompt "…"   (-p)   Provide input explicitly (any environment)
 *   --json   "…"   (-j)   Provide a structured JSON operation or array
 *   --output json  (-o)   Write machine-readable JSON result to stdout (requires --yes)
 *   --yes                  Auto-approve all prompts (non-interactive)
 *   --report-to-portal     Opt-in: report run outcome to the Portal (default off)
 *   --help, -h             Show usage
 *   --version, -v          Print version and exit
 *
 * Exit codes:
 *   0   Success (operation completed or help shown)
 *   1   Operation failed (execution error, safety block)
 *   2   Input contract/parsing error (conflicting sources, bad JSON, unknown type)
 *   3   Workflow stopped by user after approval flow starts
 *
 * --output json error enum (failure shape: { success: false, error: "<code>" }):
 *   CLI-layer (input contract / safety / CLI orchestration):
 *     conflicting_input_sources     More than one direct input source provided.
 *     invalid_json                  --json/--batch payload was not valid JSON.
 *     invalid_op                    JSON parsed but op type or fields unusable.
 *     unsupported_or_unparsed_steps Draft clause did not resolve to a
 *                                   supported deterministic op. No mutation.
 *     no_tasks_found                Input produced zero executable tasks.
 *     safety_block                  Safety gate refused the request or a clause.
 *     execution_error               Generic non-classified workflow failure.
 *     unknown                       Result file missing or unparseable.
 *   Adapter-layer (surfaced from the validator OR the cursor execution
 *   result so consumers get the precise refusal reason. Stage may differ
 *   between validate and execute for the same root cause; the public
 *   `error` field is identical per §6.5.1 rule 3):
 *     file_not_found                Target file does not exist.
 *                                   Surfaced by:
 *                                     - delete on missing path (M3 validator,
 *                                       deliberate refinement per §6.5.2;
 *                                       was execution_error before M3)
 *                                     - replace on missing target file
 *                                       (executor — content-dependent)
 *     old_value_not_found           'from' text not present in target file.
 *     ambiguous_match               'from' text appears more than once.
 *     target_exists                 Refused to overwrite an existing
 *                                   destination on a create op. No mutation.
 *                                   Surfaced by both the M3 validator
 *                                   (path-level pre-flight) and the
 *                                   executor (TOCTOU defense-in-depth).
 *     merge_conflict                Refused unsafe edit. Covers:
 *                                     - symlink target (write/append/prepend/
 *                                       rename/delete/replace)
 *                                     - binary file (NUL byte detected)
 *                                     - post-write content mismatch
 *                                   All paths: no mutation performed.
 *     parse_error                   Clause parsed but did not resolve to a
 *                                   supported operation type.
 *     scope_outside_allowed         Target file is outside write_safe_globs
 *                                   (cursor-session boundary; only fires
 *                                   when allowedFiles is non-empty).
 *     prohibited_pattern_match      Target file matches a prohibited pattern.
 *     delivery_timeout              Adapter delivery exceeded timeout budget.
 *     invalid_path                  Path contains a null byte (0x00). Refused
 *                                   at the validate stage by the M3
 *                                   FeasibilityValidator, before preview /
 *                                   approval / any fs probe. No mutation.
 *                                   Covers create / delete / rename (from
 *                                   and to) / replace.file / append.file /
 *                                   prepend.file / create_dir. Added in
 *                                   S1 / friction #26 — pre-fix behavior
 *                                   was a raw Node TypeError
 *                                   [ERR_INVALID_ARG_VALUE] from
 *                                   fs.writeFileSync, surfaced as the
 *                                   catchall execution_error AFTER the
 *                                   parent directory had been created.
 *     outside_workspace             Path resolves outside the workspace
 *                                   root. Refused at the validate stage
 *                                   by the FeasibilityValidator, before
 *                                   preview / approval / any fs probe.
 *                                   Covers POSIX absolute (/etc/x), Windows
 *                                   drive-rooted (C:\x or C:/x), Windows
 *                                   drive-relative (C:foo), UNC
 *                                   (\\srv\share\x or //srv/share/x), and
 *                                   `..`-traversal-after-normalize
 *                                   (a/../../etc). Same code is also
 *                                   surfaced from the executor as
 *                                   defense-in-depth at every fs case
 *                                   in CursorInProcessAdapter — same
 *                                   posture K4-I3 takes for replay.
 *                                   Distinct from scope_outside_allowed:
 *                                   workspace_root is the structural
 *                                   process-level boundary; allowedFiles
 *                                   is a per-cursor-session narrowing
 *                                   inside that boundary. Added in
 *                                   S2 / friction #36 — pre-fix behavior
 *                                   on the JSON / batch surfaces was
 *                                   silent fs mutation outside the
 *                                   workspace at exit-0 success, with
 *                                   no safety block, no error code, and
 *                                   no telemetry signal.
 *     invalid_filename_chars        Filename contains invisible (zero-
 *                                   width), bidirectional override, or
 *                                   control codepoints, or canonicalizes
 *                                   (NFKC) to a different string. Refused
 *                                   at the validate stage by the
 *                                   FeasibilityValidator AND re-checked
 *                                   at the executor as defense-in-depth.
 *                                   Scoped to filename-creating ops only
 *                                   (create / create_dir / rename.to);
 *                                   delete / rename.from / replace.file
 *                                   accept pre-existing bad-name files so
 *                                   the user can clean them up. Added in
 *                                   Cluster B Iteration 2 / friction
 *                                   shortgigs/usesteady-public#50 —
 *                                   pre-fix behavior accepted a U+202E
 *                                   in a filename at exit 0 because
 *                                   Cluster B Iteration 1's containment
 *                                   check (pathEscapesWorkspace) only
 *                                   caught BIDI used to mask traversal,
 *                                   not BIDI in a contained filename.
 *     invalid_replacement_chars     Replace operation's replacement text
 *                                   contains invisible (zero-width),
 *                                   bidirectional override, or control
 *                                   codepoints. Newlines, tabs, and CR
 *                                   are explicitly allowed so multi-line
 *                                   edits remain supported. Refused at
 *                                   the executor (CursorInProcessAdapter)
 *                                   before the file is read or rewritten.
 *                                   Added in Cluster B Iteration 2 /
 *                                   friction shortgigs/usesteady-public#52
 *                                   — pre-fix behavior accepted a U+202E
 *                                   in replacement text and wrote it
 *                                   verbatim to disk at exit 0.
 *     invalid_filename_reserved_name
 *                                   Filename's basename (case-
 *                                   insensitively, after trimming
 *                                   Windows-silently-stripped trailing
 *                                   dots and spaces) resolves to a
 *                                   Windows reserved device name:
 *                                   CON, PRN, AUX, NUL, COM0-COM9, or
 *                                   LPT0-LPT9. Refused cross-platform
 *                                   (not Windows-only) because a
 *                                   repository containing this filename
 *                                   cannot be cloned, archived, or
 *                                   extracted on Windows — even when
 *                                   authored on Linux or macOS. Refused
 *                                   at validate AND executor stages.
 *                                   Scoped to filename-creating ops only
 *                                   (create / create_dir / rename.to);
 *                                   delete / rename.from accept pre-
 *                                   existing reserved-name files for
 *                                   cleanup, mirroring Iteration 2's
 *                                   policy. Added in Cluster B Iteration
 *                                   3 — proactive hardening, not friction-
 *                                   driven. See
 *                                   docs/adr/ADR-cluster-b-iteration-3-
 *                                   filename-hardening.md.
 *     prohibited_path               Path lands inside a protected
 *                                   location and the tool refuses to
 *                                   operate on it. V1 protected set is
 *                                   any `.git` segment in the path --
 *                                   the Git repository's internal
 *                                   directory (HEAD, hooks/, config,
 *                                   refs/, objects/). Refused at
 *                                   validate AND executor stages for
 *                                   every path-bearing op including
 *                                   delete and rename, so `.git/HEAD`
 *                                   is never read, stat'd, or
 *                                   unlinked. Distinct from
 *                                   `invalid_filename_chars` (filename
 *                                   shape) because the path is well-
 *                                   formed and inside the workspace;
 *                                   the LOCATION is off-limits. To
 *                                   edit repository state, use `git`
 *                                   directly. Regular workspace files
 *                                   like `.gitignore` and
 *                                   `.gitattributes` are not protected
 *                                   -- only the `.git` directory
 *                                   segment matches. Added in Cluster
 *                                   B Iteration 4 / friction
 *                                   shortgigs/usesteady-public#60
 *                                   (create_dir into .git/hooks) and
 *                                   #67 (silent delete of .git/HEAD).
 *                                   See docs/adr/ADR-cluster-b-
 *                                   iteration-4-protected-paths.md.
 */
import { capture } from "../../friction/posthog.js";
import { readWorkflowTerminalOutcomeStrict } from "./workflow-outcome-file.js";
import { SessionController } from "../../session/controller.js";
import { entryApprovalDetailLines } from "./entry-approval-preview.js";
// Stabilization P0 / PR-4 — CLI-entry prompt quote sanitizer. Pure
// function extracted for unit-test isolation; see `normalize-prompt-text.ts`
// for the length guard (Fix A) and matched outer smart-quote pair strip
// (Fix B). Behavior for existing ASCII outer-pair stripping and
// shell-escape unfolding is byte-for-byte unchanged.
import { normalizePromptText } from "./normalize-prompt-text.js";
const FRICTION_REPORT_URL = "https://usesteady.dev/alpha";
// ─── M5 §13 commit 2 — one-shot approval gate via SessionController ──────────
//
// Every one-shot approval (`--prompt`, `--json`, positional NL, stdin-pipe)
// used to open its own `readline.Interface` against `process.stdin`, ask the
// question, then close it. Those sites are audit entries 6/7/8 in design §3.
//
// `askApproval()` funnels all three through a single helper that constructs a
// one-shot `SessionController`, calls `requestInput({ purpose: "approval" })`,
// and shuts the controller down — matching the exact close-after-approval
// lifecycle of the old code. Prompt bytes are byte-identical to what the
// three call-sites produced before (same leading newline, same text, same
// whitespace). Exit codes, `Cancelled.` hint text, and the non-TTY
// `--yes`-hint branch all remain in the caller; commit 2 only touches the
// "user types y/n" step.
//
// Why shutdown after every call (temporary): the caller immediately rewrites
// `process.argv` and re-imports `main.js`, which today creates its own
// `readline.Interface` at `src/shell/cli/main.ts:134`. Keeping the controller
// alive through that re-import would leave two concurrent rls on
// `process.stdin` (the single-owner invariant violation the design guards
// against). Commit 4 migrates `main.ts`'s `createRL()` to the same controller
// and this shutdown becomes unnecessary.
async function askApproval(prompt) {
    const ctrl = new SessionController({ mode: "one_shot", autoYes: false });
    try {
        return await ctrl.requestInput({ purpose: "approval", prompt, until: "line" });
    }
    finally {
        ctrl.shutdown();
    }
}
// ─── Flag pre-parse (before subcommand resolution) ───────────────────────────
// Strip global flags BEFORE subcommand parsing so they never appear as a
// positional subcommand.  Flags stripped here:
//   --prompt / -p  "..."   explicit input value
//   --json   / -j  "..."   structured JSON operation
//   --output / -o  "json"  machine-readable output mode
//   --yes                  auto-approve all prompts
//   --report-to-portal     opt-in: report run outcome to Portal (P0-49, default off)
//   --help / -h            show usage
//   --version / -v         print version and exit
//
// After stripping, process.argv[2] is the real subcommand (or undefined).
const rawArgs = process.argv.slice(2);
// R3 (M4, design §6.6.2) — reject duplicate --prompt/-p *before* pre-parse
// collapses tail tokens into the first flag's value. Today the legacy logic
// silently concatenates the second occurrence into the first, so the caller
// never sees the duplication.
//
// Error code is `conflicting_input_sources` (not `parse_error`): duplicate
// --prompt is semantically "the same input source supplied twice", which is
// the exact failure mode the existing `failInputSourceConflict` helper
// already models for (stdin + --prompt), (--prompt + --json), etc. Keeping
// the error code consistent lets machine consumers branch on a single code
// for all input-source conflicts. Stage is "input" (argv parsing) because
// the failure is detected before any normalizer runs.
//
// Detected inline (sync) so we can fail before any dynamic imports run.
{
    let duplicatePromptSeen = false;
    let firstIdx = -1;
    for (let i = 0; i < rawArgs.length; i += 1) {
        const t = rawArgs[i];
        if (t === "--prompt" || t === "-p") {
            if (firstIdx === -1) {
                firstIdx = i;
            }
            else {
                duplicatePromptSeen = true;
                break;
            }
        }
    }
    if (duplicatePromptSeen) {
        const msg = "--prompt specified twice";
        if (process.argv.includes("--output") && process.argv[process.argv.indexOf("--output") + 1] === "json") {
            // Shape mirrors failInputSourceConflict: `sources` lists the
            // conflicting source identifiers. For duplicate --prompt the same
            // source appears twice, which is the precise semantic.
            process.stdout.write(JSON.stringify({
                success: false,
                error: "conflicting_input_sources",
                stage: "input",
                sources: ["--prompt", "--prompt"],
                message: msg,
            }) + "\n");
        }
        else {
            process.stderr.write(`\n  Error: conflicting input sources: --prompt, --prompt\n` +
                `  ${msg}. Provide exactly one --prompt value.\n` +
                `  Report friction: ${FRICTION_REPORT_URL}\n\n`);
        }
        process.exit(2);
    }
}
// Strip --prompt/-p and capture its value.
// Capture all tokens until the next recognized global flag so shell-escaped
// quoting variants (especially on Windows/PowerShell) still collapse back
// into a single prompt string.
const promptIdx = rawArgs.findIndex(a => a === "--prompt" || a === "-p");
let promptFlag = null;
if (promptIdx >= 0) {
    let end = promptIdx + 1;
    while (end < rawArgs.length) {
        const token = rawArgs[end];
        const isNextGlobalFlag = token === "--json" ||
            token === "-j" ||
            token === "--output" ||
            token === "-o" ||
            token === "--yes" ||
            token === "--help" ||
            token === "-h" ||
            token === "--version" ||
            token === "-v";
        if (isNextGlobalFlag)
            break;
        end += 1;
    }
    const captured = rawArgs.slice(promptIdx + 1, end).join(" ").trim();
    promptFlag = captured.length > 0 ? captured : null;
    rawArgs.splice(promptIdx, end - promptIdx);
}
// Strip --json/-j and capture its value.
const jsonIdx = rawArgs.findIndex(a => a === "--json" || a === "-j");
const jsonFlag = jsonIdx >= 0 ? (rawArgs[jsonIdx + 1] ?? null) : null;
if (jsonIdx >= 0)
    rawArgs.splice(jsonIdx, jsonFlag !== null ? 2 : 1);
// Strip --output/-o and capture its value.
const outputIdx = rawArgs.findIndex(a => a === "--output" || a === "-o");
const outputMode = outputIdx >= 0 ? (rawArgs[outputIdx + 1] ?? null) : null;
if (outputIdx >= 0)
    rawArgs.splice(outputIdx, outputMode !== null ? 2 : 1);
const jsonOutput = outputMode === "json";
const fileOutput = outputMode === "file";
// Strip --yes (boolean flag — no value to capture).
const yesIdx = rawArgs.indexOf("--yes");
const autoYes = yesIdx >= 0;
if (yesIdx >= 0) {
    rawArgs.splice(yesIdx, 1);
}
// Strip --report-to-portal (P0-49 Execution Return Bridge opt-in, default off).
// Like executionPolicy, this crosses the `await import("./main.js")` boundary via
// an env var, because several dispatch paths reconstruct process.argv. The flag
// is boolean and best-effort; main.ts gates the actual send on this + env config.
const reportToPortalIdx = rawArgs.indexOf("--report-to-portal");
if (reportToPortalIdx >= 0) {
    rawArgs.splice(reportToPortalIdx, 1);
    process.env["USESTEADY_REPORT_TO_PORTAL"] = "1";
}
// Strip --pending-approval-bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1 opt-in,
// default off). Like --report-to-portal, the flag crosses the
// `await import("./main.js")` boundary via an env var because several dispatch
// paths reconstruct process.argv. main.ts gates the actual live-approval routing
// on this flag PLUS USESTEADY_PORTAL_APPROVALS_URL + USESTEADY_PORTAL_TOKEN; with
// any piece missing the existing local approval flow is used, byte-for-byte.
const pendingApprovalBridgeIdx = rawArgs.indexOf("--pending-approval-bridge");
if (pendingApprovalBridgeIdx >= 0) {
    rawArgs.splice(pendingApprovalBridgeIdx, 1);
    process.env["USESTEADY_PENDING_APPROVAL_BRIDGE"] = "1";
}
// Rebuild process.argv from stripped rawArgs so subcommand resolution is clean.
process.argv = [process.argv[0], process.argv[1], ...rawArgs];
const [, , subcommand, ...rest] = process.argv;
const isTTY = Boolean(process.stdin.isTTY);
function resolveDirectInputSource(params) {
    const sources = [];
    if (params.hasStdin)
        sources.push("stdin");
    if (params.hasPrompt)
        sources.push("--prompt");
    if (params.hasJson)
        sources.push("--json");
    if (params.hasArgv)
        sources.push("argv");
    if (params.hasBatch)
        sources.push("batch");
    if (sources.length > 1)
        return { ok: false, sources };
    return { ok: true, source: sources[0] ?? null };
}
// Pure subcommands — orthogonal to direct-input conflict detection.
//
// These tokens identify their own subcommand handler and never carry the
// user's request text in the positional slot, so the source-contract layer
// must not flag them when ambient stdin happens to be open. Pre-K1, this set
// covered only the interactive/admin verbs. K1 added `replay` (verification-
// only artifact integrity check) and K4 added `replay … --execute`; both
// take only an artifact path positional and never read user prose from
// stdin. Omitting `replay` here caused `usesteady replay <file>` invoked
// from any non-TTY context with an open (unredirected) stdin to block
// indefinitely on `readStdinPiped()` waiting for an EOF that never came —
// observed live during the alpha.45 install probe. Adding it brings the
// stdin-sampling decision in line with the actual handler contract.
//
// S1 / friction #35 follow-up: `--version` and `-v` are pure for the same
// structural reason — they print a single line and exit, never reading user
// prose. Pre-fix, `--version` was missing from this set, so `usesteady
// --version` invoked non-TTY with an unredirected stdin (the default
// `child_process.spawn` shape) blocked on `readStdinPiped()` forever. Same
// friction class as the K1/K4 replay miss; same structural fix.
const PURE_SUBCOMMANDS = new Set([
    "run", "history",
    "setup", "help", "report", "admin",
    "replay",
    "capabilities",
    "quickstart",
    "templates",
    "examples",
    "doctor",
    "auth",
    "timeline",
    "reconstruct",
    "audit",
    "usage",
    "workflow",
    "--help", "-h",
    "--version", "-v",
]);
// Classify the positional subcommand slot. A "direct-request argv" is any
// non-empty subcommand token that is neither a pure subcommand nor the
// `batch` subcommand — i.e. it carries (or is expected to carry) the user's
// request text directly.
const isPureSubcommand = subcommand !== undefined && PURE_SUBCOMMANDS.has(subcommand);
const isBatchSubcommand = subcommand === "batch";
const hasArgvDirectRequest = subcommand !== undefined && subcommand.length > 0
    && !isPureSubcommand && !isBatchSubcommand;
// --output json requires --yes for any execution path (output is only
// guaranteed in non-interactive mode). `capabilities`, `templates`,
// `quickstart`, and `examples` are pure read-only catalog commands that
// never execute anything, so --yes is meaningless for them; exempt them
// from the check. See docs/product/useability-and-guided-execution-
// track.md sections 3.1 (capabilities), 3.2 (templates), the onboarding
// follow-on slice (quickstart), and the workflow-invocation-shapes slice
// (examples).
if (jsonOutput && !autoYes
    && subcommand !== "capabilities"
    && subcommand !== "templates"
    && subcommand !== "quickstart"
    && subcommand !== "examples"
    && subcommand !== "timeline"
    && subcommand !== "reconstruct"
    && subcommand !== "audit"
    && subcommand !== "usage"
    && subcommand !== "auth"
    && subcommand !== "workflow") {
    process.stderr.write("\n  Error: --output json requires --yes\n" +
        "  Structured JSON output is only guaranteed in non-interactive (--yes) mode.\n" +
        frictionHintLine() +
        "\n");
    process.exit(2);
}
// Suppress all human prose on stdout when --output json is active.
// main.ts print() checks this env var and becomes a no-op.
if (jsonOutput) {
    process.env["USESTEADY_QUIET"] = "true";
}
// Read piped stdin once so source resolution is deterministic.
//
// We sample stdin for every non-TTY entry path that could compete with stdin
// as a direct-input source — i.e. everything EXCEPT pure subcommands (run /
// history / cursor / claude / setup / ui / help / report / admin). Pre-fix
// we only sampled when no subcommand was present, which let piped stdin
// get silently dropped by `usesteady "..."` and `usesteady batch ops.json`
// invocations. We now sample whenever stdin could be a legitimate competing
// source so conflict detection can flag the combination up-front.
//
// Post-alpha.47 contract repair (CLI Contract Audit / friction "F5: Windows
// batch --yes hang"): if the caller has set `--yes` AND has provided an
// explicit non-stdin input source (`batch <file>`, `--json`, or `--prompt`),
// we skip stdin sampling. Rationale:
//
//   - `--yes` is the explicit non-interactive contract. The caller is
//     promising they will not interact, and the explicit input source is
//     unambiguous about what to execute. Sampling stdin in this case can
//     only serve conflict detection.
//   - On Windows, a child process spawned with an inherited-but-not-redirected
//     stdin (Start-Process default, some CI runners, hidden-window invocations)
//     reports `isTTY === false` but never receives EOF, so `readStdinPiped()`
//     blocks indefinitely. The hang is observable end-to-end as
//     "batch --yes never returns" with no diagnostic.
//   - Conflict detection for `echo "..." | usesteady batch ops.json` (no
//     --yes) is still active — interactive callers don't trip the hang
//     because their stdin is either a real pipe (closes after the data) or
//     a real TTY (handled by the !isTTY guard). The protected case is
//     CI/auto callers, who use --yes by definition.
//
// This is the same friction class as the alpha.45 replay hang and S1 / #35
// help/version hang: a non-pure subcommand sampled stdin with no deadline
// in a non-TTY-non-EOF environment. The scoped fix preserves all existing
// conflict detection except for the precise cell `--yes && explicit-source`,
// which the design treats as an unambiguous non-interactive contract.
const hasExplicitNonStdinSource = isBatchSubcommand || jsonFlag !== null || promptFlag !== null;
const shouldSampleDirectStdin = !isTTY && !isPureSubcommand && !(autoYes && hasExplicitNonStdinSource);
const pipedStdinInput = shouldSampleDirectStdin ? await readStdinPiped() : "";
const hasStdinSource = pipedStdinInput.trim().length > 0;
// ─── Stdin pipe reader ────────────────────────────────────────────────────────
//
// M5 §13 commit 3 — audit entry 10 migration.
//
// Previously this function consumed `process.stdin` directly via a
// `for await (const chunk of process.stdin)` loop. That was the one remaining
// direct-stream reader in the CLI; every other reader used `createInterface`.
// Now the SessionController's `requestInput({ until: "eof" })` encapsulates
// the bulk read, so this function becomes a thin wrapper that delegates and
// applies the historical trim-trailing-whitespace behavior.
//
// Behavior parity: the controller's bulk-read drains the same stream using
// the same async iterator, then returns the concatenated utf-8 string. The
// `.trim()` is preserved here because callers (source detection, input
// dispatch) compare against trimmed text (see `hasStdinSource =
// pipedStdinInput.trim().length > 0` at the caller). Moving the trim into
// the helper keeps the caller unchanged.
async function readStdinPiped() {
    const ctrl = new SessionController({ mode: "one_shot", autoYes: false });
    try {
        const raw = await ctrl.requestInput({ purpose: "bulk", prompt: "", until: "eof" });
        return raw.trim();
    }
    finally {
        ctrl.shutdown();
    }
}
// ─── Help / usage ─────────────────────────────────────────────────────────────
const HELP_TEXT = `
  UseSteady -- AI-assisted code execution with SYSTEM WILL shown before filesystem changes on the interactive path.

  Interactive requests are parsed and shown as SYSTEM WILL or refused.
  You see SYSTEM WILL -- the exact change -- then approve it. --yes skips per-step prompts.

  Supported operations:
    replace "X" with "Y" in <file> <first|all|Nth occurrence>
                                      Replace exact text in a file.
                                      Occurrence declares intent only: "first" still
                                      requires a unique match (multiple matches are
                                      refused, never selected); "all" / Nth are refused.
    append "X" to <file>              Append exact text to a file
    prepend "X" to <file>             Prepend exact text to a file
    rename <old> to <new>             Rename a file or folder
    create file <path>                Create a new file
    mkdir <path>                      Create a new directory
    delete file <path>                Delete a file
    run <command>                     Run a shell command (approval-gated: you approve
                                      the exact command before anything runs)

  Usage:
    usesteady                                     Interactive session
    usesteady --prompt "rename X to Y"            Explicit input (Windows/CI safe)
    usesteady "rename X to Y"                     Positional input
    echo "rename X to Y" | usesteady             Piped stdin
    usesteady run spec.json                       Run a workflow (interactive)
    usesteady run spec.json --yes                 Run a workflow (non-interactive, CI)
    usesteady --json '{"type":"rename","from":"old.ts","to":"new.ts"}' --yes
    usesteady batch operations.json --yes         Run a batch of JSON operations
    usesteady replay <artifact-file>              Verify a persisted kernel replay artifact
    usesteady replay <artifact-file> --execute    Re-run the artifact in a sandbox; verify outcome
                                                  (artifact-file is a single JSON file
                                                  written at <store>/replay/<sha256>.artifact.json
                                                  with shape { version, ir, result, checksum }.
                                                  Not a JSONL journal.
                                                  --execute supports file-operation tasks
                                                  (create_dir / write_file / append_file /
                                                  prepend_file / rename / delete_file),
                                                  structured-replace tasks, and the K5+K6 in-scope
                                                  run_command shapes: 'echo <args>', 'true',
                                                  'false', and 'node -e "<BODY>"' for the
                                                  closed K6 inline-JS body allow-list. Out-of-scope
                                                  commands refuse with reason
                                                  "non_deterministic_command", out-of-scope
                                                  inline-JS bodies refuse with reason
                                                  "non_deterministic_inline_js".
                                                  This closed list scopes replay verification
                                                  ONLY. Live execution (usesteady run / --json /
                                                  batch) is a separate approval-gated path:
                                                  the exact command is shown at the approval
                                                  step and runs as approved — it is NOT
                                                  restricted to this list.)
    usesteady setup                               Configure Anthropic API key
    usesteady report                              Submit a friction report
    usesteady history                             Browse audit trail
    usesteady quickstart                          First 5 minutes: discovery -> template -> safe run
    usesteady doctor                              Check local install readiness (read-only)
    usesteady auth refresh                        Fetch Team entitlement projection (read-only cache)
    usesteady auth status                         Show cached entitlement visibility (no network)
    usesteady auth logout                         Remove local entitlement cache only
    usesteady timeline --last                     Chronological view of latest terminal run (read-only)
    usesteady timeline --run-id <id>              Chronological view of one terminal run (read-only)
    usesteady timeline --last --output json       Same view, machine-readable JSON (read-only)
    usesteady reconstruct <ucp_root_id>           Rebuild what happened from a UCP root (read-only)
    usesteady reconstruct <ucp_root_id> --output json   Machine-readable reconstruction report
    usesteady audit export --run-id <id>          Export one terminal run as JSON (read-only)
    usesteady audit export --run-id <id> --output file
                                                  Write export to ./audit-exports/<run-id>.json
    usesteady audit summary --last                Operational summary of latest run (read-only)
    usesteady usage summary                     Local usage summary (read-only)
    usesteady capabilities                        Print catalog of supported operations
    usesteady capabilities --output json          Same catalog, machine-readable JSON
    usesteady templates                           List starter workflow templates
    usesteady templates <name>                    Print one template in detail
    usesteady templates <name> --output json      Same template, machine-readable JSON
    usesteady examples                            Three invocation shapes (--json / batch / run)
    usesteady examples --output json              Same patterns, machine-readable JSON
    usesteady help                                Show this help
    Friction URL                                  ${FRICTION_REPORT_URL}

  Flags:
    --prompt "..."  -p "..."   Provide input explicitly (avoids shell quoting issues)
    --json   "..."  -j "..."   Provide a structured JSON operation (or JSON array)
    --output json   -o json    Write machine-readable JSON result to stdout (requires --yes)
    --yes                   Auto-approve all steps (non-interactive / CI mode)
    --help, -h              Show this help
    --version, -v           Print version and exit

  JSON op schema (--json and batch):
    { "type": "replace",    "from": "old", "to": "new", "file": "path/to/file", "occurrence": "first" }
    { "type": "rename",     "from": "old.ts", "to": "new.ts" }
    { "type": "create",     "file": "path/to/file" }
    { "type": "create_dir", "path": "path/to/dir" }
    { "type": "delete",     "file": "path/to/file" }
    { "type": "run",        "to": "npm test" }
    { "type": "append",     "file": "path/to/file", "to": "text to append" }
    { "type": "prepend",    "file": "path/to/file", "to": "text to prepend" }

    Note: "run" executes the exact command you approve, as written. The closed
    replay command list (see 'replay --execute' above) scopes replay
    verification only and never restricts live execution.

  Workflow spec.json schema (run <spec.json> subcommand):
    The "run" subcommand accepts THREE JSON shapes — pick whichever matches
    your use case. All three execute through the same workflow loop.

    1. WorkflowSpec  (full multi-task workflow with NL inputs):
         {
           "name": "<workflow name>",
           "defaultRuntime": "cursor",
           "tasks": [
             { "input": "<NL phrase>", "label": "<optional>", "targetFiles": [ "..." ] }
           ]
         }
       Optional task fields: "runtime" ("cursor" | "claude"), "operationType",
       "structuredReplace" ({oldValue, newValue, filePath}).
       Optional spec fields: "maxRetries" (number), "defaultRuntime".

    2. JSON op       (auto-wrapped into a one-task WorkflowSpec):
         { "type": "<op>", ... }
       Same shape as the --json flag. See "JSON op schema" above for every
       supported op. Auto-wrapped to a one-task spec named "Run spec: 1
       operation(s)" with defaultRuntime "cursor".

    3. JSON op array (auto-wrapped into an N-task WorkflowSpec):
         [ { "type": "<op>", ... }, { "type": "<op>", ... }, ... ]
       Same shape as the batch subcommand. Auto-wrapped to an N-task spec
       named "Run spec: N operation(s)" with defaultRuntime "cursor".

  Break-glass mode (audited operator escape hatch):
    An explicit, operator-controlled way to skip the per-step approval prompt
    for a workflow run. It is NOT a default and is never silent:
      - Declared when the run is created; cannot be enabled mid-run.
      - A reason is required and recorded.
      - The run is permanently marked as break-glass and written to the local history record.
      - The run is permanently marked as break-glass.
      - Same workspace limits, runtime, and seam as a normal run.
    Use only when knowingly accepting unattended execution. If unsure, run
    normally and approve each step.

  --output json result schema:
    { "success": true }
    { "success": true, "stdout": "...", "stderr": "", "exitCode": 0 }  # run command
    { "success": false, "error": "<code>" }   # see error codes below

  --output json error codes (all documented, surfaced verbatim):
    CLI-layer (input contract / safety / CLI orchestration):
      conflicting_input_sources     More than one direct input source provided.
      invalid_json                  --json/--batch payload was not valid JSON.
      invalid_op                    JSON parsed but op type or fields unusable.
      unsupported_or_unparsed_steps Draft had at least one clause that did not
                                    resolve to a supported deterministic op.
                                    No mutation performed.
      no_tasks_found                Input produced zero executable tasks.
      safety_block                  Safety gate refused the request or a clause.
      execution_error               Generic non-classified workflow failure.
      unknown                       Result file missing or unparseable.
    Adapter-layer (surfaced verbatim from the cursor execution result):
      file_not_found                Target file does not exist.
      old_value_not_found           'from' text not present in target file.
      ambiguous_match               'from' text appears more than once.
      target_exists                 Refused to overwrite an existing
                                    destination on a create op. No mutation.
      merge_conflict                Refused unsafe edit: symlink target,
                                    binary file, or post-write content
                                    mismatch. No mutation performed.
      parse_error                   Clause parsed but did not resolve to a
                                    supported operation.
      scope_outside_allowed         Target file is outside write_safe_globs
                                    (cursor-session boundary).
      prohibited_pattern_match      Target file matches a prohibited pattern.
      delivery_timeout              Adapter delivery exceeded timeout budget.
      invalid_path                  Path contains a null byte (0x00). Refused
                                    at the validate stage before any fs probe
                                    or preview. Covers create / delete /
                                    rename / replace / append / prepend /
                                    create_dir. (S1 / friction #26.)
      outside_workspace             Path resolves outside the workspace root.
                                    Refused at the validate stage before any
                                    fs probe or preview, and re-checked at
                                    the executor as defense-in-depth. Covers
                                    POSIX absolute (/etc/x), Windows drive-
                                    rooted (C:\\x, C:/x), Windows drive-
                                    relative (C:foo), UNC (\\\\srv\\share\\x,
                                    //srv/share/x), and \`..\`-after-normalize
                                    (a/../../etc). Distinct from
                                    scope_outside_allowed (workspace boundary
                                    vs. cursor-session allowedFiles).
                                    (S2 / friction #36.)
      invalid_filename_chars        Filename contains invisible / bidi /
                                    control codepoints, or canonicalizes
                                    (NFKC) to a different string. Refused at
                                    the validate stage before any fs probe,
                                    and re-checked at the executor as
                                    defense-in-depth. Scoped to filename-
                                    creating ops (create / create_dir /
                                    rename.to). delete / rename.from /
                                    replace.file accept pre-existing bad
                                    names so they can be cleaned up.
                                    (Cluster B Iter 2 / public#50.)
      invalid_replacement_chars     Replace newValue contains invisible /
                                    bidi / control codepoints. Newlines,
                                    tabs, and CR are explicitly allowed.
                                    Refused at the executor before the
                                    file is read or rewritten.
                                    (Cluster B Iter 2 / public#52.)
      invalid_filename_reserved_name
                                    Filename basename (case-insensitively,
                                    after trimming Windows-silently-
                                    stripped trailing dots and spaces)
                                    resolves to CON, PRN, AUX, NUL,
                                    COM0-COM9, or LPT0-LPT9. Refused
                                    cross-platform (not Windows-only)
                                    because the resulting repository
                                    cannot be cloned, archived, or
                                    extracted on Windows. Scoped to
                                    filename-creating ops only; delete /
                                    rename.from accept pre-existing
                                    reserved-name files for cleanup.
                                    (Cluster B Iter 3.)
      prohibited_path               Path lands inside a protected
                                    location and the tool refuses to
                                    operate on it. V1 protected set
                                    matches a '.git' segment anywhere
                                    in the path -- Git's repository
                                    internals (HEAD, hooks/, config,
                                    refs/, objects/). Path is well-
                                    formed and inside the workspace;
                                    only the LOCATION is off-limits
                                    because edits inside '.git/'
                                    corrupt the repository silently
                                    and bypass Git's own consistency
                                    checks. Refused at validate AND
                                    executor stages for every path-
                                    bearing op (including delete and
                                    rename), so '.git/HEAD' is never
                                    read, stat'd, or unlinked. To edit
                                    repository state, run git
                                    directly (git update-ref, git
                                    config, etc.). Regular workspace
                                    files like '.gitignore',
                                    '.gitattributes', and '.gitkeep'
                                    remain unprotected -- only the
                                    '.git' directory segment matches.
                                    (Cluster B Iter 4 / public#60, #67.)

  Exit codes:
    0   Success (operation completed or help shown)
    1   Operation failed (execution error, safety block)
    2   Input contract/parsing error (conflicting sources, bad JSON, unknown op type)
    3   Workflow stopped by user after approval flow starts

  Replay artifacts:
    Replay artifacts (<store>/replay/<sha256>.artifact.json) are persisted only
    for runs that executed. Runs refused before execution (parse-stage rejects
    such as invalid_op / invalid_json, or validate-stage rejects such as
    invalid_path / outside_workspace) produce no replay artifact by design —
    there is no "execution truth" to record.

  Examples:
    # macOS / Linux
    usesteady --prompt 'replace "Submit" with "Send" in src/Button.tsx'

    # Windows PowerShell
    usesteady --prompt "replace 'Submit' with 'Send' in src/Button.tsx"

    # Piped stdin
    echo "rename old.ts to new.ts" | usesteady

    # CI automation
    usesteady run deploy.json --yes

    # Structured JSON (programmatic callers)
    usesteady --json '{"type":"replace","from":"foo","to":"bar","file":"src/x.ts"}' --yes

    # Create a directory
    usesteady --json '{"type":"create_dir","path":"src/components"}' --yes

    # Batch from file
    usesteady batch ops.json --yes

    # Machine-readable output
    usesteady --json '{"type":"rename","from":"a.ts","to":"b.ts"}' --yes --output json
`.trimEnd();
// ─── Draft-task → WorkflowSpecTask helper ─────────────────────────────────────
// Converts a DraftTask into a structured workflow spec task, setting
// operationType / targetFiles / content / command / structuredReplace as
// appropriate. Both the stdin/--prompt/argv path (processDraftInput) and the
// --json/batch path (processJsonInput) route through this helper so that
// natural-language and JSON inputs produce identical workflow behavior.
//
// S3 / friction #40 — extracted to `src/shell/cli/spec-task-builder.ts` so
// the same conversion is reused by `loadWorkflowSpecFromFile`'s auto-wrap
// path (run <single-op>.json / run <op-array>.json). Re-exported here for
// import-site stability; existing call sites continue to use the local
// names. See `spec-task-builder.ts` for the canonical implementation.
import { draftTaskToSpecTask as draftTaskToSpecTaskShared, } from "./spec-task-builder.js";
function draftTaskToSpecTask(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
t, i, 
// The third arg (`draftTaskToInput`) is retained for source-level call
// compatibility — the shared helper imports it directly so it is never
// read here. Marked `_` to flag the intent without an unused-var lint.
// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
_draftTaskToInput) {
    return draftTaskToSpecTaskShared(t, i);
}
async function readWorkflowResult(resultPath) {
    try {
        const { existsSync, readFileSync, rmSync } = await import("node:fs");
        if (!existsSync(resultPath))
            return null;
        const data = JSON.parse(readFileSync(resultPath, "utf8"));
        rmSync(resultPath, { force: true });
        return data;
    }
    catch {
        return null;
    }
}
/** Emits the JSON result object and returns true if the operation succeeded. */
async function emitJsonResult(resultPath) {
    const result = await readWorkflowResult(resultPath);
    // Stabilization P0 / PR-2 — always project the deterministic summary
    // shape. The five fields (success, error, failed_at_step,
    // executed_steps, total_steps) are propagated verbatim from the
    // intermediate result-file written by main.ts. For pre-PR-2 result-
    // files (or degenerate paths where the summary was not built), we
    // fall back to the legacy projection so older test fixtures and
    // consumers continue to work. Adding optional nullable fields on
    // success is strictly additive for consumers.
    if (result?.succeeded) {
        process.stdout.write(JSON.stringify({
            success: true,
            error: null,
            ...(typeof result.failed_at_step === "number" || result.failed_at_step === null
                ? { failed_at_step: result.failed_at_step }
                : { failed_at_step: null }),
            ...(typeof result.executed_steps === "number"
                ? { executed_steps: result.executed_steps }
                : {}),
            ...(typeof result.total_steps === "number"
                ? { total_steps: result.total_steps }
                : {}),
            // Issue #42 -- guarded projection. Only emit `warnings_accepted`
            // when the result file actually carries it (post-#42 main.ts
            // always sets it; pre-#42 fixture files won't, and we must not
            // invent data). The shape of the field is `number` to match the
            // ExecutionSummary contract.
            ...(typeof result.warnings_accepted === "number"
                ? { warnings_accepted: result.warnings_accepted }
                : {}),
            ...(typeof result.stdout === "string" ? { stdout: result.stdout } : {}),
            ...(typeof result.stderr === "string" ? { stderr: result.stderr } : {}),
            ...(typeof result.exitCode === "number" ? { exitCode: result.exitCode } : {}),
        }) + "\n");
        return true;
    }
    else {
        process.stdout.write(JSON.stringify({
            success: false,
            error: result?.errorCode ?? "unknown",
            ...(typeof result?.failed_at_step === "number" || result?.failed_at_step === null
                ? { failed_at_step: result?.failed_at_step ?? null }
                : {}),
            ...(typeof result?.executed_steps === "number"
                ? { executed_steps: result.executed_steps }
                : {}),
            ...(typeof result?.total_steps === "number"
                ? { total_steps: result.total_steps }
                : {}),
            // Issue #42 -- guarded projection on the failure branch too.
            // Symmetric to the success branch: emit only when the upstream
            // result file naturally carries the field. main.ts always sets
            // it after #42 even on failure paths (it is summed from the
            // tasks that did execute, which may be zero), so post-#42 runs
            // will surface `warnings_accepted: 0` on failures where no
            // warning was accepted before the failure point. We do NOT
            // invent data when the field is absent.
            ...(typeof result?.warnings_accepted === "number"
                ? { warnings_accepted: result.warnings_accepted }
                : {}),
            ...(typeof result?.stdout === "string" ? { stdout: result.stdout } : {}),
            ...(typeof result?.stderr === "string" ? { stderr: result.stderr } : {}),
            ...(typeof result?.exitCode === "number" ? { exitCode: result.exitCode } : {}),
        }) + "\n");
        return false;
    }
}
function workflowOutcomeReadErrorMessage(error) {
    if (error === "missing")
        return "missing terminal outcome from delegated workflow run";
    if (error === "token_mismatch")
        return "terminal outcome token mismatch (stale or foreign outcome file)";
    return "malformed terminal outcome from delegated workflow run";
}
function frictionHintLine() {
    return `  Report friction: ${FRICTION_REPORT_URL}\n`;
}
/**
 * usesteady-public#45 — render the user's explicit replace occurrence
 * directive for the `--output json` error payload. Returns `undefined`
 * when the validate-stage refusal did not originate from an explicit
 * occurrence directive (i.e. the refusal is `ambiguous_match` for some
 * other replace reason, or the op was not a replace). Caller threads
 * the result into the JSON payload as `requested_occurrence` only when
 * defined, so older fixtures with no field continue to match.
 *
 * Mirrors `formatRequestedOccurrence` in `feasibility-validator.ts` to
 * keep the public diagnostic phrasing byte-identical between the stderr
 * message (`"first occurrence"` / `"all occurrences"` / `"3rd
 * occurrence"`) and the JSON output.
 *
 * Typed against a duck shape rather than `ValidateError` to avoid a
 * top-level import of `cli-error.ts` (the validator module is loaded
 * dynamically below; pulling the type would introduce an eager import).
 */
function requestedOccurrenceForJsonError(validateError) {
    const op = validateError.operation;
    if (op.type !== "replace")
        return undefined;
    const req = op.args["requestedOccurrence"];
    if (req === undefined)
        return undefined;
    if (req === "first")
        return "first";
    if (req === "all")
        return "all";
    if (typeof req === "object" &&
        req !== null &&
        "index" in req &&
        typeof req.index === "number") {
        const n = req.index;
        const mod100 = n % 100;
        const suffix = mod100 >= 11 && mod100 <= 13 ? "th"
            : n % 10 === 1 ? "st"
                : n % 10 === 2 ? "nd"
                    : n % 10 === 3 ? "rd"
                        : "th";
        return `${n}${suffix}`;
    }
    return undefined;
}
function failInputSourceConflict(sources) {
    const listed = sources.join(", ");
    if (jsonOutput) {
        process.stdout.write(JSON.stringify({
            success: false,
            error: "conflicting_input_sources",
            sources,
        }) + "\n");
    }
    else {
        process.stderr.write(`\n  Error: conflicting input sources: ${listed}\n` +
            "  Provide exactly one input source: stdin, --prompt, or --json.\n" +
            `  Report friction: ${FRICTION_REPORT_URL}\n\n`);
    }
    process.exit(2);
}
function failUnsupportedDraftClauses(clauses) {
    if (jsonOutput) {
        process.stdout.write(JSON.stringify({
            success: false,
            error: "unsupported_or_unparsed_steps",
            clauses,
        }) + "\n");
    }
    else {
        const rendered = clauses.map(c => `    - ${c}`).join("\n");
        process.stderr.write("\n  Error: unsupported or unparsed steps detected.\n" +
            "  UseSteady requires fully parsed, deterministic steps before execution.\n" +
            "  Review and rewrite these step(s):\n" +
            `${rendered}\n\n` +
            "  Supported formats:\n" +
            '    replace "X" with "Y" in <file>\n' +
            '    append "X" to <file>\n' +
            '    prepend "X" to <file>\n' +
            "    rename <old> to <new>\n" +
            "    create file <path>\n" +
            "    delete file <path>\n" +
            "    run <safe-command>\n\n" +
            `  Report friction: ${FRICTION_REPORT_URL}\n\n`);
    }
    process.exit(2);
}
// ─── Safety-gate aware draft processor ───────────────────────────────────────
// Shared by --prompt, stdin-pipe, and positional-argv paths.
async function processDraftInput(input, autoYes, inputMode) {
    capture("session_started", {
        input_mode: inputMode,
        execution_mode: autoYes ? "auto" : "draft",
        is_tty: isTTY,
    });
    const { translateIntent, formatDraftTask, draftTaskToInput } = await import("./draft/intent-to-tasks.js");
    const { runSafetyGate } = await import("../../safety/safety-gate.js");
    // Safety gate — runs before SYSTEM WILL preview is shown.
    const safetyBlock = runSafetyGate(input);
    if (safetyBlock.verdict === "block") {
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({ success: false, error: "safety_block" }) + "\n");
            process.exit(1);
        }
        // 4-pre: render the SAME `safety` RoutingSurface every CLI entry path emits.
        // The git-history vs generic footer now lives inside renderSafety (keyed on
        // detectorId), so the footer is preserved identically without hand-rolling.
        const { safetySurface } = await import("../../workflow/routing-surface.js");
        const { renderSurfaceCli } = await import("../render-surface-cli.js");
        process.stdout.write(renderSurfaceCli(safetySurface({
            reason: safetyBlock.reason ?? "blocked",
            note: safetyBlock.note ?? safetyBlock.reason ?? "This request was blocked by the safety gate.",
            blockedInput: input,
            matchedPattern: safetyBlock.matchedPattern,
            detectorId: safetyBlock.detectorId,
        })).join("\n") + "\n");
        process.exit(1);
    }
    const tasks = translateIntent(input);
    // Per-task safety gate (catches compound requests with one dangerous clause).
    for (const task of tasks) {
        const taskInput = draftTaskToInput(task);
        const taskSafety = runSafetyGate(taskInput);
        if (taskSafety.verdict === "block") {
            if (jsonOutput) {
                process.stdout.write(JSON.stringify({ success: false, error: "safety_block" }) + "\n");
                process.exit(1);
            }
            process.stdout.write([
                "",
                "  [blocked] One or more steps can't be processed safely.",
                `     Blocked: "${task.rawText ?? taskInput}"`,
                `     Reason: ${taskSafety.note ?? taskSafety.reason}`,
                "",
                "  Break this into separate requests and omit the unsafe step.",
                "",
            ].join("\n"));
            process.exit(1);
        }
    }
    const actionable = tasks.filter(t => !t.needs_confirmation);
    const uncertain = tasks.filter(t => t.needs_confirmation);
    // Pre-flight hint — only in interactive draft mode, not for --prompt/stdin.
    const POLITE_RE = /^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+(?:need|want)\s+(?:you\s+)?to\s+|would\s+you\s+)/i;
    const DIRECT_RE = /^(replace|append|prepend|rename|create\s+(?:file|folder|directory)|delete\s+(?:file|folder|directory)|run)\s+/i;
    const stripped = input.replace(POLITE_RE, "");
    const needsHint = inputMode === "argv" && !DIRECT_RE.test(stripped);
    if (actionable.length === 0) {
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({ success: false, error: "no_tasks_found" }) + "\n");
            process.exit(2);
        }
        if (needsHint) {
            process.stdout.write([
                "",
                "  UseSteady works best with specific file changes.",
                "  If needed, I'll help you rewrite your request before anything runs.",
                "",
            ].join("\n"));
        }
        process.stdout.write([
            "",
            "  I couldn't translate that into structured steps.",
            "  Supported formats:",
            '    replace "X" with "Y" in <file>',
            '    append "X" to <file>',
            '    prepend "X" to <file>',
            "    rename <old> to <new>",
            "    create file <path>",
            "    delete file <path>",
            "    run <safe-command>",
            "",
            "  Tip: use --prompt to avoid shell quoting issues.",
            '    usesteady --prompt "rename old.ts to new.ts"',
            "",
            "  For guided input, run usesteady with no arguments.",
            "",
        ].join("\n"));
        if (!isTTY || autoYes) {
            // Non-interactive: exit with error code so scripts can detect failure.
            process.exit(2);
        }
        // Interactive: fall through to cursor session with prefill.
        const root = process.cwd();
        process.argv = [process.argv[0], process.argv[1], "cursor", root, "--prefill", input];
        {
            // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
            // Dynamic import resolves on top-level evaluation, not on `main()`
            // settle. We must await the exported completion promise before
            // returning, otherwise the parent runs ahead and (in the workflow
            // sites below) reads the outcome file before the child writes it,
            // then `process.exit(1)` kills the still-running child mid-batch.
            const _main = await import("./main.js");
            await _main._runComplete;
        }
        return;
    }
    if (uncertain.length > 0) {
        failUnsupportedDraftClauses(uncertain.map(task => task.rawText ?? draftTaskToInput(task)));
    }
    // Show pre-approval intake echo (suppressed in --output json mode).
    //
    // alpha.56 / F-A55-3: the parsed-stage glyph is `[parsed]`, never
    // `[ok]`. The pre-alpha.56 wording read as "completed", which is
    // exactly the lifecycle stage the COMPLETED frame's `[done]` glyph
    // already owns. Renaming preserves all behavior; only the visible
    // tag and the section header change. The needs_confirmation case
    // keeps a distinct `?` glyph so unparseable clauses remain
    // visually separated from successfully parsed ones.
    if (!jsonOutput) {
        process.stdout.write("\n  Parsed your request into safe steps (not yet executed):\n\n");
        tasks.forEach((t, i) => {
            const symbol = t.needs_confirmation ? "  [ ? ]" : "  [parsed]";
            process.stdout.write(`${symbol} Step ${i + 1}: ${formatDraftTask(t)}\n`);
            // F10-W2: informed pre-approval surface — the same rendering truth
            // the downstream SYSTEM WILL frame shows, printed BEFORE the single
            // plan-level approval below. The DraftTask→SpecTask conversion is
            // the pure function the post-approval path uses below; preview-only,
            // no spec mutation. `[ ? ]` clauses carry no derivable operation and
            // render no detail (fail-closed, same as the frame preview).
            if (!t.needs_confirmation) {
                const detail = entryApprovalDetailLines(draftTaskToSpecTask(t, i, draftTaskToInput));
                if (detail.length > 0)
                    process.stdout.write(detail.join("\n") + "\n");
            }
        });
        if (uncertain.length > 0) {
            process.stdout.write([
                "",
                `  ${uncertain.length} step(s) marked [ ? ] could not be fully parsed.`,
                "  They will be passed as-is and may be skipped if unrecognised.",
            ].join("\n") + "\n");
        }
    }
    // Approval — auto if --yes or non-TTY without explicit flag.
    let ans;
    if (autoYes || !isTTY) {
        // Non-interactive: auto-approve actionable steps.
        if (!isTTY && !autoYes) {
            // Piped stdin without --yes: show plan and exit safely (no execution).
            if (!jsonOutput) {
                process.stdout.write([
                    "",
                    "  [non-interactive] Add --yes to execute these steps automatically.",
                    "",
                ].join("\n"));
            }
            process.exit(0);
        }
        ans = "y";
        if (!jsonOutput) {
            process.stdout.write("\n  [--yes] Auto-approved.\n");
        }
    }
    else {
        // M5 §13 commit 2: draft-preview approval via SessionController.
        ans = (await askApproval("\n  Approve these steps? (y/n/edit): "))
            .trim()
            .toLowerCase();
    }
    if (ans === "y" || ans === "yes") {
        const specTasks = tasks.map((t, i) => draftTaskToSpecTask(t, i, draftTaskToInput));
        const spec = JSON.stringify({
            name: `Draft: ${input.slice(0, 60)}`,
            tasks: specTasks,
            defaultRuntime: "cursor",
        });
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const { writeFileSync } = await import("node:fs");
        const tmpSpec = join(tmpdir(), `usesteady-draft-${Date.now()}.json`);
        writeFileSync(tmpSpec, spec, "utf8");
        // Set result-file path for --output json capture.
        let resultPath;
        if (jsonOutput) {
            resultPath = join(tmpdir(), `usesteady-result-${Date.now()}.json`);
            process.env["USESTEADY_RESULT_PATH"] = resultPath;
        }
        // Set terminal-outcome path so delegated workflow exits remain deterministic.
        const outcomePath = join(tmpdir(), `usesteady-outcome-${Date.now()}.json`);
        const outcomeToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        process.env["USESTEADY_WORKFLOW_OUTCOME_PATH"] = outcomePath;
        process.env["USESTEADY_WORKFLOW_OUTCOME_TOKEN"] = outcomeToken;
        // The draft layer already obtained the user's approval for the full plan
        // (either --yes or readline "y"). The spawned workflow is therefore a
        // single atomic execution — always pass --yes through so the workflow
        // loop (a) does not re-prompt per-task (redundant with draft-layer
        // approval) and (b) returns after the first terminal outcome instead of
        // asking "Run another workflow?" (which hangs non-TTY and is wrong UX
        // for --prompt/stdin/argv one-shot invocations).
        const yesFlag = ["--yes"];
        process.argv = [process.argv[0], process.argv[1], "workflow", tmpSpec, process.cwd(), ...yesFlag];
        {
            // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
            // Dynamic import resolves on top-level evaluation, not on `main()`
            // settle. We must await the exported completion promise before
            // returning, otherwise the parent runs ahead and (in the workflow
            // sites below) reads the outcome file before the child writes it,
            // then `process.exit(1)` kills the still-running child mid-batch.
            const _main = await import("./main.js");
            await _main._runComplete;
        }
        const terminal = await readWorkflowTerminalOutcomeStrict(outcomePath, outcomeToken);
        if (!terminal.ok) {
            const msg = workflowOutcomeReadErrorMessage(terminal.error);
            if (jsonOutput) {
                process.stdout.write(JSON.stringify({ success: false, error: "execution_error" }) + "\n");
            }
            else {
                process.stderr.write(`\n  Error: ${msg}\n\n`);
            }
            process.exit(1);
        }
        if (jsonOutput && resultPath) {
            const ok = await emitJsonResult(resultPath);
            process.exit(ok ? 0 : 1);
        }
        process.exit(terminal.record.exitCode);
    }
    else if ((ans === "edit" || ans === "e") && isTTY) {
        if (!jsonOutput) {
            process.stdout.write("  Opening interactive session -- refine your request:\n");
        }
        process.argv = [process.argv[0], process.argv[1], "cursor", process.cwd(), "--prefill", input];
        {
            // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
            // Dynamic import resolves on top-level evaluation, not on `main()`
            // settle. We must await the exported completion promise before
            // returning, otherwise the parent runs ahead and (in the workflow
            // sites below) reads the outcome file before the child writes it,
            // then `process.exit(1)` kills the still-running child mid-batch.
            const _main = await import("./main.js");
            await _main._runComplete;
        }
    }
    else {
        if (!jsonOutput) {
            process.stdout.write("  Cancelled.\n" + frictionHintLine() + "\n");
        }
        process.exit(0);
    }
}
// ─── Structured JSON input processor ─────────────────────────────────────────
// Handles --json and batch subcommand.  All ops converge into the exact same
// workflow execution path as processDraftInput — no new execution semantics.
async function processJsonInput(jsonStr, autoYes, surface) {
    // 1. Parse JSON.  Strip UTF-8 BOM if present (common from PowerShell Out-File).
    const jsonStripped = jsonStr.charCodeAt(0) === 0xFEFF ? jsonStr.slice(1) : jsonStr;
    const { parseJsonInput } = await import("../../input/parse-json-input.js");
    const parseResult = parseJsonInput(jsonStripped.trim());
    if (!parseResult.ok) {
        const surfaceHint = surface === "batch"
            ? "  The batch <file> command expects a JSON array of op objects.\n"
            : "  The --json flag expects a single inline JSON op object (or an array).\n";
        const errorLine = parseResult.message === "input is not valid JSON"
            ? "input is not valid JSON"
            : parseResult.message;
        process.stderr.write("\n  Error: " + errorLine + "\n" +
            surfaceHint +
            "  See `usesteady examples` for the three accepted invocation shapes.\n" +
            frictionHintLine() + "\n");
        if (jsonOutput)
            process.stdout.write(JSON.stringify({ success: false, error: "invalid_json" }) + "\n");
        process.exit(2);
    }
    const parsed = parseResult.value;
    // 2. Normalize to array so single-op and multi-op share the same path.
    const ops = Array.isArray(parsed) ? parsed : [parsed];
    // 3. Convert each op to DraftTask via the M2 input pipeline (JSON → IR →
    //    DraftTask shim). The validation rules and the per-op short-circuit
    //    semantics are preserved exactly; the shadow-envelope persistence loop
    //    structure is preserved exactly. See src/input/json-to-ir.ts and
    //    src/input/ir-to-draft.ts for the contract.
    //
    //    Per-op iteration is intentional (not buildIRFromJsonOps): if op[i] is
    //    invalid, ops [0..i-1] still persist their shadow envelopes before the
    //    process exits, matching the legacy behavior. After the loop succeeds,
    //    we materialize the IR aggregate so it's available to downstream
    //    milestones (M3 validator, M5 SessionController) — in M2 it is
    //    constructed and held but not yet read.
    const { formatDraftTask, draftTaskToInput } = await import("./draft/intent-to-tasks.js");
    const { jsonOpToIROperation, diagnoseInvalidJsonOp } = await import("../../input/json-to-ir.js");
    const { irOperationToJsonDraftTask } = await import("../../input/ir-to-draft.js");
    const { mapJsonOpToCommandEnvelope } = await import("../../ucp/mappers/map-json-op-command.js");
    const { persistEnvelope } = await import("../../ucp/persistence/write.js");
    const { resolveStoreDir } = await import("../defaults.js");
    // Parallel index-aligned arrays (one entry per IR op).
    //
    // The JSON / batch surface accepts 8 ops post-alpha.47 (CLI Contract Audit).
    // Seven of those round-trip through `DraftTask` (for preview formatting,
    // shadow-envelope persistence, and downstream `draftTaskToSpecTask`).
    // `create_dir` does NOT round-trip through `DraftTask` because the legacy
    // shape has no matching `action` variant — the IR→DraftTask shim is
    // designed to throw on it. We branch on `irOp.type === "create_dir"`
    // BEFORE calling the shim and synthesize the workflow `SpecTask` directly,
    // matching the same bypass pattern that `processNLInput` already uses
    // (M4 §6.6, NL path). UCP shadow-envelope persistence intentionally has
    // no `create_dir` mapper (UCP is out of scope for this contract repair),
    // so create_dir entries skip that side effect.
    const previewLines = [];
    const safetyInputs = [];
    const specTasks = [];
    const irOperations = [];
    for (const op of ops) {
        const irOp = jsonOpToIROperation(op);
        if (irOp === null) {
            // alpha.57 -- workflow invocation ergonomics. The JSON parsed but
            // either `type` is missing/unknown or the required fields for the
            // op type are wrong. Point at `usesteady capabilities` for the
            // full per-op schema and `usesteady examples` for the surrounding
            // invocation shape. Error class (`invalid_op`) and the JSON-mode
            // body are unchanged.
            //
            // R-alpha-min publication truthfulness: when a specific public-wire
            // required field is missing (or present-but-not-a-string), include
            // the field-level diagnostic from `diagnoseInvalidJsonOp`. The
            // accept/reject boundary is unchanged -- this is a stderr text
            // enrichment only. JSON output payload remains
            // `{ success: false, error: "invalid_op" }` byte-identical.
            const diagnostic = diagnoseInvalidJsonOp(op);
            const diagnosticLine = diagnostic !== null ? `  ${diagnostic}\n` : "";
            process.stderr.write(`\n  Error: unknown or invalid operation: ${JSON.stringify(op)}\n` +
                diagnosticLine +
                "  See `usesteady capabilities` for the full per-op JSON schema\n" +
                "  (required and optional fields per op type).\n" +
                "  See `usesteady examples` for the three accepted invocation shapes.\n" +
                frictionHintLine() + "\n");
            if (jsonOutput)
                process.stdout.write(JSON.stringify({ success: false, error: "invalid_op" }) + "\n");
            process.exit(2);
        }
        const i = irOperations.length;
        irOperations.push(irOp);
        if (irOp.type === "create_dir") {
            const rendered = `create folder ${formatPathTokenForDiagnostics(irOp.args.path)}`;
            previewLines.push(rendered);
            safetyInputs.push(rendered);
            specTasks.push({
                input: rendered,
                label: `Step ${i + 1}`,
                operationType: "create_dir",
                targetFiles: [irOp.args.path],
            });
            continue;
        }
        const task = irOperationToJsonDraftTask(irOp);
        previewLines.push(formatDraftTask(task));
        safetyInputs.push(task.action === "run_command" && typeof task.to === "string"
            ? task.to
            : draftTaskToInput(task));
        // F8-W4 / usesteady-public#45 — mirror an explicit occurrence
        // directive onto the SpecTask (diagnostics/render slot only;
        // executor unchanged). Non-"first" directives are refused by the
        // validate stage before any approval surface renders, so only
        // "first" is ever displayed. Same propagation as
        // buildSpecTasksFromIROps (spec-task-builder.ts).
        specTasks.push({
            ...draftTaskToSpecTask(task, i, draftTaskToInput),
            ...(irOp.type === "replace" && irOp.args.requestedOccurrence !== undefined
                ? { requestedOccurrence: irOp.args.requestedOccurrence }
                : {}),
        });
        // PR2 shadow mode: persist a normalized command envelope for observability.
        // Live execution ownership remains unchanged (workflow path below).
        const shadowOp = task.action === "replace" && task.from !== undefined && task.to !== undefined && task.file !== undefined
            ? { type: "replace", from: task.from, to: task.to, file: task.file }
            : task.action === "rename" && task.from !== undefined && task.to !== undefined
                ? { type: "rename", from: task.from, to: task.to }
                : task.action === "create" && task.file !== undefined
                    ? { type: "create", file: task.file }
                    : task.action === "delete" && task.file !== undefined
                        ? { type: "delete", file: task.file }
                        : task.action === "run_command" && task.to !== undefined
                            ? { type: "run", to: task.to }
                            : task.action === "append" && task.to !== undefined && task.file !== undefined
                                ? { type: "append", to: task.to, file: task.file }
                                : task.action === "prepend" && task.to !== undefined && task.file !== undefined
                                    ? { type: "prepend", to: task.to, file: task.file }
                                    : null;
        if (shadowOp !== null) {
            const envelope = mapJsonOpToCommandEnvelope(shadowOp);
            persistEnvelope(resolveStoreDir(), envelope);
        }
    }
    // 3.5. Materialize the IR aggregate. M2 deliverable: --json and batch
    //      both produce a canonical IR object. Downstream consumers in M2 do
    //      not yet read this; M3 (FeasibilityValidator) and M5 (SessionController)
    //      will. Holding it here keeps the IR construction inside the input
    //      pipeline rather than scattered at the call sites.
    //
    //      `_ir` is intentionally underscored to indicate "constructed but not
    //      yet consumed" — TS will warn if a future edit accidentally drops it.
    const _ir = {
        operations: irOperations,
        source: { surface, raw: jsonStripped },
    };
    void _ir;
    // 4. Safety gate — identical to processDraftInput; --json bypasses nothing.
    //    Safety stays first so that safety_block continues to win over any
    //    feasibility error when both apply (preserves byte-for-byte ordering).
    //    `safetyInputs` is the per-op canonical text (DraftTask-derived for
    //    the 7 round-tripping ops, "create folder <path>" for create_dir).
    const { runSafetyGate } = await import("../../safety/safety-gate.js");
    for (const taskInput of safetyInputs) {
        const safety = runSafetyGate(taskInput);
        if (safety.verdict === "block") {
            process.stderr.write(`\n  Blocked: ${safety.note ?? safety.reason}\n\n`);
            if (jsonOutput) {
                process.stdout.write(JSON.stringify({ success: false, error: "safety_block" }) + "\n");
            }
            else {
                // 4-pre: present the SAME `safety` RoutingSurface object every CLI entry
                // path emits, via the pure renderSurfaceCli. Detection (runSafetyGate)
                // and the JSON contract above are unchanged — only the human render is
                // unified so cross-surface parity holds on all paths.
                const { safetySurface } = await import("../../workflow/routing-surface.js");
                const { renderSurfaceCli } = await import("../render-surface-cli.js");
                process.stdout.write(renderSurfaceCli(safetySurface({
                    reason: safety.reason ?? "blocked",
                    note: safety.note ?? safety.reason ?? "This request was blocked by the safety gate.",
                    blockedInput: taskInput,
                    matchedPattern: safety.matchedPattern,
                    detectorId: safety.detectorId,
                })).join("\n") + "\n");
            }
            process.exit(1);
        }
    }
    // 4.5. M3 FeasibilityValidator — path-level pre-flight on the IR.
    //
    //      Per design §3.3 + §6.5 (`docs/CLI_INPUT_NORMALIZATION_DESIGN.md`
    //      v2.2), this stage hoists a subset of the executor's pre-execution
    //      checks out into a dedicated validate stage:
    //        * `create` (write_file) target already exists → target_exists
    //        * `rename` destination already exists         → target_exists
    //        * `delete` target missing                     → file_not_found
    //          (deliberate public-surface refinement per §6.5.2 — was
    //          execution_error before M3; consumers can treat it additively)
    //        * symlink path-level refusal on write/rename  → merge_conflict
    //
    //      The executor's existing guards stay in place as TOCTOU defense-in-
    //      depth (§6.5.1 rule 2). Content-dependent checks (`replace`'s
    //      file_not_found / old_value_not_found / ambiguous_match, binary-file
    //      refusals) remain at execute time because the validator MUST NOT
    //      open files (§6.5.1 rule 1).
    //
    //      `append` / `prepend` deliberately have NO missing-target check at
    //      either stage — their existing semantics are create-if-missing
    //      (matching POSIX `>>`).
    const { validateIR } = await import("../../input/feasibility-validator.js");
    const validateError = validateIR(_ir, { workspaceRoot: process.cwd() });
    if (validateError !== null) {
        // Stderr line mirrors the executor's existing "detail" format so the
        // human-readable message is unchanged from the user's perspective; the
        // machine-readable `error` field carries the precise code per the
        // public Adapter-layer enum documented in the JSDoc header above.
        process.stderr.write(`\n  ${validateError.message}\n\n`);
        if (jsonOutput) {
            // usesteady-public#45 — when the refusal originated from an
            // explicit non-"first" occurrence directive, surface the user's
            // directive verbatim in the JSON payload. Older fixtures with no
            // explicit directive keep the original two-field shape.
            const requestedOcc = requestedOccurrenceForJsonError(validateError);
            const payload = { success: false, error: validateError.code };
            if (requestedOcc !== undefined)
                payload["requested_occurrence"] = requestedOcc;
            process.stdout.write(JSON.stringify(payload) + "\n");
        }
        process.exit(1);
    }
    // 5. Show pre-approval intake echo (suppressed by USESTEADY_QUIET in --output json mode).
    // alpha.56 / F-A55-3: `[parsed]` glyph; explicit "not yet executed" wording.
    // F10-W2: each parsed step is followed by the decision-relevant detail
    // (canonical anchor + SYSTEM WILL preview content) BEFORE the single
    // plan-level approval below — same rendering truth, earlier lifecycle.
    if (!jsonOutput) {
        process.stdout.write("\n  Parsed your request into safe steps (not yet executed):\n\n");
        previewLines.forEach((line, i) => {
            process.stdout.write(`  [parsed] Step ${i + 1}: ${line}\n`);
            const detail = entryApprovalDetailLines(specTasks[i]);
            if (detail.length > 0)
                process.stdout.write(detail.join("\n") + "\n");
        });
    }
    // 6. Approval.
    // --output json guard at entry point guarantees autoYes is true in JSON mode.
    let ans;
    if (autoYes || !isTTY) {
        if (!isTTY && !autoYes) {
            if (!jsonOutput) {
                process.stdout.write("\n  [non-interactive] Add --yes to execute these steps automatically.\n\n");
            }
            process.exit(0);
        }
        ans = "y";
        if (!jsonOutput) {
            process.stdout.write("\n  [--yes] Auto-approved.\n");
        }
    }
    else {
        // M5 §13 commit 2: JSON one-shot approval via SessionController.
        ans = (await askApproval("\n  Approve these steps? (y/n): "))
            .trim()
            .toLowerCase();
    }
    if (ans !== "y" && ans !== "yes") {
        if (!jsonOutput)
            process.stdout.write("  Cancelled.\n" + frictionHintLine() + "\n");
        process.exit(0);
    }
    // 7. Build spec and execute via the same workflow path as run spec.json --yes.
    //
    // `specTasks` was built parallel to `irOperations` in the loop above:
    // - 7 ops route through `irOperationToJsonDraftTask` + `draftTaskToSpecTask`,
    //   so replace's `structuredReplace`, rename's `from`/`to`, and run_command's
    //   `to` survive byte-identically (the regex parser in parseChange is
    //   bypassed for replace).
    // - `create_dir` was synthesized directly with `operationType: "create_dir"`
    //   and `targetFiles: [path]` (post-alpha.47 contract repair).
    const spec = JSON.stringify({
        name: `JSON: ${ops.length} operation(s)`,
        tasks: specTasks,
        defaultRuntime: "cursor",
    });
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { writeFileSync } = await import("node:fs");
    const tmpSpec = join(tmpdir(), `usesteady-json-${Date.now()}.json`);
    writeFileSync(tmpSpec, spec, "utf8");
    // Set result-file path for --output json capture.
    let resultPath;
    if (jsonOutput) {
        resultPath = join(tmpdir(), `usesteady-result-${Date.now()}.json`);
        process.env["USESTEADY_RESULT_PATH"] = resultPath;
    }
    // Capture explicit terminal classification from delegated workflow run.
    const outcomePath = join(tmpdir(), `usesteady-outcome-${Date.now()}.json`);
    const outcomeToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.env["USESTEADY_WORKFLOW_OUTCOME_PATH"] = outcomePath;
    process.env["USESTEADY_WORKFLOW_OUTCOME_TOKEN"] = outcomeToken;
    // Stabilization P0 / PR-3: batch fail-fast.
    // Declare the execution policy to main.ts via env var (the only channel
    // across the `await import("./main.js")` boundary). Scope (D1):
    //   - surface === "batch"                          → batch_fail_fast
    //   - surface === "json" AND Array.isArray(parsed) → batch_fail_fast
    //   - single-object --json                         → interactive (unchanged)
    // main.ts reads USESTEADY_BATCH_FAIL_FAST when constructing the loop.
    const { BATCH_FAIL_FAST_ENV, shouldBatchFailFast } = await import("./execution-policy.js");
    if (shouldBatchFailFast({ surface, parsed })) {
        process.env[BATCH_FAIL_FAST_ENV] = "true";
    }
    else {
        delete process.env[BATCH_FAIL_FAST_ENV];
    }
    // The caller already gave explicit approval above (either --yes or
    // readline "y"). The spawned workflow is a single atomic execution —
    // always pass --yes through so the workflow loop returns after the first
    // terminal outcome instead of asking "Run another workflow?". This prevents
    // the post-approve hang in --prompt / --json / stdin-pipe one-shot modes.
    const yesFlag = ["--yes"];
    process.argv = [process.argv[0], process.argv[1], "workflow", tmpSpec, process.cwd(), ...yesFlag];
    {
        // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
        // Dynamic import resolves on top-level evaluation, not on `main()`
        // settle. We must await the exported completion promise before
        // returning, otherwise the parent runs ahead and (in the workflow
        // sites here) reads the outcome file before the child writes it,
        // then `process.exit(1)` kills the still-running child mid-batch.
        const _main = await import("./main.js");
        await _main._runComplete;
    }
    // 8. Emit structured JSON result and exit with appropriate code.
    const terminal = await readWorkflowTerminalOutcomeStrict(outcomePath, outcomeToken);
    if (!terminal.ok) {
        const msg = workflowOutcomeReadErrorMessage(terminal.error);
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({ success: false, error: "execution_error" }) + "\n");
        }
        else {
            process.stderr.write(`\n  Error: ${msg}\n\n`);
        }
        process.exit(1);
    }
    if (jsonOutput && resultPath) {
        const ok = await emitJsonResult(resultPath);
        process.exit(ok ? 0 : 1);
    }
    process.exit(terminal.record.exitCode);
}
// ─── M4 — NL input processor ─────────────────────────────────────────────────
//
// `processNLInput` is the M4 hot-path replacement for `processDraftInput`
// on the three NL surfaces (--prompt, stdin pipe, bare positional argv).
// It converts NL → IR via the deterministic `normalizeNLToIR` (zero LLM,
// zero legacy-parser heuristics), then reuses the M3 `validateIR` and the
// existing workflow delegation machinery.
//
// Recovery parity (CLI/Web — P1):
//   When normalization fails with `parse_error`, delegate a single-task
//   WorkflowSpec with raw NL (same as web `/api/workflow/start`). The
//   coordinator routes to `skipped_by_intake` — no execution, no approval
//   bypass. R4 (`ambiguous_match`) and other hard rejects still exit 2.
async function delegateRawInputToWorkflow(nlInput, workflowName) {
    const spec = JSON.stringify({
        name: workflowName,
        tasks: [{ input: nlInput }],
        defaultRuntime: "cursor",
    });
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { writeFileSync } = await import("node:fs");
    const tmpSpec = join(tmpdir(), `usesteady-nl-recovery-${Date.now()}.json`);
    writeFileSync(tmpSpec, spec, "utf8");
    let resultPath;
    if (jsonOutput) {
        resultPath = join(tmpdir(), `usesteady-result-${Date.now()}.json`);
        process.env["USESTEADY_RESULT_PATH"] = resultPath;
    }
    const outcomePath = join(tmpdir(), `usesteady-outcome-${Date.now()}.json`);
    const outcomeToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.env["USESTEADY_WORKFLOW_OUTCOME_PATH"] = outcomePath;
    process.env["USESTEADY_WORKFLOW_OUTCOME_TOKEN"] = outcomeToken;
    // Skip-only recovery runs have no approval surface; always pass --yes so
    // the workflow loop returns after the terminal outcome (non-TTY safe).
    process.argv = [process.argv[0], process.argv[1], "workflow", tmpSpec, process.cwd(), "--yes"];
    {
        const _main = await import("./main.js");
        await _main._runComplete;
    }
    const terminal = await readWorkflowTerminalOutcomeStrict(outcomePath, outcomeToken);
    if (!terminal.ok) {
        const msg = workflowOutcomeReadErrorMessage(terminal.error);
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({ success: false, error: "execution_error" }) + "\n");
        }
        else {
            process.stderr.write(`\n  Error: ${msg}\n\n`);
        }
        process.exit(1);
    }
    if (jsonOutput && resultPath) {
        const ok = await emitJsonResult(resultPath);
        process.exit(ok ? 0 : 1);
    }
    process.exit(terminal.record.exitCode);
}
/**
 * 3C-3: route a recovery (unparseable) NL input through the SAME RoutingSurface
 * brain the web `/api/workflow/start` uses, so the CLI presents SYSTEM SUGGESTS
 * and REFLECTION instead of only generic intake format hints. CLI/web cannot
 * diverge on the recovery decision by construction (Phase 6, Path A: both
 * delegate to the shared entry `computeArtifactsForSpec` + the shared
 * `concreteSuggestions`).
 *
 * Zero authority, no filesystem mutation. Returns the surface to render
 * (system_suggests | reflection), or undefined to fall through to the legacy
 * intake-recovery delegate. Never throws (recovery must never crash the CLI).
 */
async function cliRecoverySurface(nlInput) {
    try {
        const [{ synthesizeFirstTaskFromNL, computeArtifactsForSpec }, { concreteSuggestions }, loader, { LocalRecoveryAdapter }, path, fs, url] = await Promise.all([
            import("../../workflow/cross-surface-parity.js"),
            import("../../skills/concrete-suggestions.js"),
            import("../../skills/loader.js"),
            import("../../skills/local-recovery-adapter.js"),
            import("node:path"),
            import("node:fs"),
            import("node:url"),
        ]);
        // Phase 4: build the first task via the shared parity harness, so the CLI's
        // spec construction is literally the same code the cross-surface parity test
        // binds to (CLI and Web cannot fork their NL->task synthesis).
        const firstTask = synthesizeFirstTaskFromNL(nlInput);
        // Resolve the bundled skills/ relative to THIS module (works from any cwd and
        // for the installed npm package), so SYSTEM SUGGESTS parity does not depend on
        // the caller's working directory. Falls back to cwd/skills.
        const here = path.dirname(url.fileURLToPath(import.meta.url));
        const skillsDir = [
            path.resolve(here, "../../../../skills"), // dist/src/shell/cli -> package root
            path.resolve(here, "../../../skills"), // src/shell/cli      -> repo root (tsx dev)
            path.join(process.cwd(), "skills"), // cwd fallback
        ].find(c => fs.existsSync(c)) ?? path.join(process.cwd(), "skills");
        const scan = await loader
            .scanSkillsDirectory(skillsDir)
            .catch(() => ({ registry: loader.buildRegistry([]) }));
        const registry = scan.registry;
        const adapter = new LocalRecoveryAdapter();
        // Phase 6 (Path A): route via the SAME shared engine core the web start
        // handler and the internal SDK delegate to (`computeArtifactsForSpec`), so the
        // safety-ahead-of-routing order is applied in exactly one place across every
        // surface. Recovery only needs the routing `surface`; the basis/fingerprint
        // it also computes are unused here (recovery never reaches the approval gate).
        const artifacts = await computeArtifactsForSpec({
            spec: { name: "NL recovery", tasks: [firstTask] },
            root: process.cwd(),
            suggest: (input) => concreteSuggestions(input, { registry, adapter }),
            repository: null,
        });
        return artifacts.surface;
    }
    catch {
        return undefined;
    }
}
async function processNLInput(nlInput, autoYes, surface) {
    // R1 — single-authority safety at the NL ENTRY boundary (Trust Surface Model,
    // Phase 2 remediation). Gate the verbatim NL through the SAME
    // `gateWorkflowSpecSafety` the web `POST /api/workflow/start` uses, BEFORE
    // normalize, so EVERY parse outcome (ok / parse_error / ambiguous_match) is
    // refused identically to the web. This is the single chokepoint every NL
    // surface (--prompt, stdin, positional) passes through, so it CLOSES the
    // long-standing parse_error safety gap rather than moving it. A block renders
    // the `safety` RoutingSurface via `renderSurfaceCli` (CLI and web present the
    // same engine object) and exits 1. Authority stays with the safety gate; the
    // shared routing entry is never consulted on a block.
    {
        const { gateWorkflowSpecSafety } = await import("../../workflow/spec-safety-gate.js");
        const verdict = gateWorkflowSpecSafety({ name: "nl-entry", tasks: [{ input: nlInput }] });
        if (verdict.verdict === "block") {
            capture("session_started", {
                input_mode: surface === "prompt" ? "prompt_flag" :
                    surface === "stdin" ? "stdin_pipe" :
                        /* positional */ "argv",
                execution_mode: autoYes ? "auto" : "draft",
                is_tty: isTTY,
            });
            if (jsonOutput) {
                process.stdout.write(JSON.stringify({ success: false, error: "safety_block" }) + "\n");
            }
            else {
                const { safetySurfaceFromVerdict } = await import("../../workflow/routing-surface-derive.js");
                const { renderSurfaceCli } = await import("../render-surface-cli.js");
                const safetySurfaceObj = safetySurfaceFromVerdict(verdict);
                if (safetySurfaceObj) {
                    process.stdout.write(renderSurfaceCli(safetySurfaceObj).join("\n") + "\n");
                }
            }
            process.exit(1);
        }
    }
    const { normalizeNLToIR } = await import("../../input/nl-to-ir.js");
    // Map the CLI input surface to the IR source surface. "stdin" is not a
    // first-class `IRSourceSurface` value (M2 freeze), so the normalizer
    // collapses it onto "prompt" for the IR's diagnostics-only surface field
    // while leaving the `raw` field byte-verbatim. The CLI still reports
    // "stdin" in its own input_mode telemetry below.
    const result = normalizeNLToIR(nlInput, surface);
    if (result.kind === "error") {
        const err = result.error;
        if (err.code === "parse_error") {
            // Clarify-then-promote (USESTEADY_CLARIFY_THEN_PROMOTE_V1 — Phase 2/CLI).
            // When the failure is recoverable with exactly one missing slot (a rename
            // destination, or a file-vs-folder choice) and the session is
            // interactive, ask for that one slot, reconstruct the canonical NL, and
            // re-route through the SAME pipeline. No operation is synthesized here:
            // the promotion to a SYSTEM WILL is produced solely by re-running
            // `processNLInput` (which re-runs `normalizeNLToIR`). Any failure falls
            // through to the existing intake-recovery path below (fail closed).
            if (isTTY && !autoYes && !jsonOutput) {
                const { classifyClarifyRecoverability, reconstructClarifiedInput } = await import("../../input/clarify-recoverability.js");
                const rec = classifyClarifyRecoverability(nlInput);
                if (rec.kind !== "not_recoverable") {
                    const answer = await askApproval(`\n  ${rec.prompt}\n  > `);
                    const reconstructed = reconstructClarifiedInput(rec, answer);
                    if (reconstructed !== null &&
                        normalizeNLToIR(reconstructed, surface).kind === "ok") {
                        process.stdout.write(`\n  Got it -> ${reconstructed}\n`);
                        await processNLInput(reconstructed, autoYes, surface);
                        return; // processNLInput exits the process; defensive only.
                    }
                    process.stdout.write("\n  That still isn't a concrete step I can form.\n");
                }
            }
            // AI_SEAMS_V1 seam 1 (L2.S2) — candidate understanding.
            // Deterministic-first (INV-AI-1): this runs only after normalizeNLToIR
            // failed AND the deterministic clarify-then-promote path above could not
            // recover. Interactive-only, advisory-only, fail-closed (INV-AI-2/3): no
            // key, API failure, or an unparseable rewrite skips the branch and the
            // CLI behaves byte-for-byte as before this seam existed. A human confirm
            // re-enters the FULL pipeline (safety gate + parser + approval gate) via
            // processNLInput — the candidate itself never executes and is never
            // auto-confirmed; only an explicit "y" continues, and execution still
            // requires the normal SYSTEM WILL approval afterward. A correction
            // re-enters understanding from the top with the human's own words.
            if (isTTY && !autoYes && !jsonOutput) {
                const [{ proposeCandidateUnderstanding }, { hydrateEnvFromConfig }] = await Promise.all([
                    import("../../intake/candidate-understanding.js"),
                    import("./config-hydration.js"),
                ]);
                hydrateEnvFromConfig(); // ~/.usesteady/config.json key -> env (env always wins)
                const candidate = await proposeCandidateUnderstanding(nlInput);
                if (candidate) {
                    capture("candidate_understanding_shown", {
                        family: candidate.family,
                        confidence: candidate.confidence,
                    });
                    const answer = (await askApproval(`\n  I think you want: ${candidate.rewrite}\n` +
                        `  [y] continue with this  [n] no  — or type a correction\n  > `)).trim();
                    const lower = answer.toLowerCase();
                    if (lower === "y" || lower === "yes") {
                        capture("candidate_understanding_confirmed", { family: candidate.family });
                        process.stdout.write(`\n  Confirmed -> ${candidate.rewrite}\n`);
                        await processNLInput(candidate.rewrite, autoYes, surface);
                        return; // processNLInput exits the process; defensive only.
                    }
                    if (lower !== "" && lower !== "n" && lower !== "no") {
                        capture("candidate_understanding_corrected", { family: candidate.family });
                        await processNLInput(answer, autoYes, surface);
                        return; // processNLInput exits the process; defensive only.
                    }
                    capture("candidate_understanding_declined", { family: candidate.family });
                    // Declined: fall through to today's deterministic recovery surface.
                }
            }
            // 3C-3: present SYSTEM SUGGESTS / REFLECTION via the shared RoutingSurface
            // brain (renderSurfaceCli) so the CLI matches the web's recovery surface.
            // Zero authority, no fs mutation, exit 0. Only when not in JSON mode (the
            // JSON contract keeps its existing error shape). Falls through to the
            // legacy intake-recovery delegate when no surface can be honestly formed.
            if (!jsonOutput) {
                const recoverySurface = await cliRecoverySurface(nlInput);
                if (recoverySurface &&
                    (recoverySurface.type === "system_suggests" || recoverySurface.type === "reflection")) {
                    capture("session_started", {
                        input_mode: surface === "prompt" ? "prompt_flag" :
                            surface === "stdin" ? "stdin_pipe" :
                                /* positional */ "argv",
                        execution_mode: autoYes ? "auto" : "draft",
                        is_tty: isTTY,
                    });
                    const { renderSurfaceCli } = await import("../render-surface-cli.js");
                    process.stdout.write(renderSurfaceCli(recoverySurface).join("\n") + "\n");
                    process.exit(0);
                }
            }
            capture("session_started", {
                input_mode: surface === "prompt" ? "prompt_flag" :
                    surface === "stdin" ? "stdin_pipe" :
                        /* positional */ "argv",
                execution_mode: autoYes ? "auto" : "draft",
                is_tty: isTTY,
            });
            if (!jsonOutput) {
                process.stdout.write("\n  Input could not be parsed as a single supported operation.\n" +
                    "  Running through workflow intake recovery (nothing executes until understood).\n\n");
            }
            await delegateRawInputToWorkflow(nlInput, `NL recovery: ${nlInput.slice(0, 60)}`);
        }
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({
                success: false,
                error: err.code,
                stage: err.stage,
                message: err.message,
            }) + "\n");
        }
        else {
            process.stderr.write(`\n  Error: ${err.message}\n` + frictionHintLine() + "\n");
        }
        process.exit(2);
    }
    const ir = result.ir;
    capture("session_started", {
        input_mode: surface === "prompt" ? "prompt_flag" :
            surface === "stdin" ? "stdin_pipe" :
                /* positional */ "argv",
        execution_mode: autoYes ? "auto" : "draft",
        is_tty: isTTY,
    });
    // 1. Safety gate already ran at the NL entry boundary (top of processNLInput,
    //    R1). A dangerous verbatim NL never reaches here — it exits 1 before
    //    normalize. Single authority, no second gating surface to drift.
    // 2. M3 FeasibilityValidator — path-level pre-flight on the IR.
    const { validateIR } = await import("../../input/feasibility-validator.js");
    const validateError = validateIR(ir, { workspaceRoot: process.cwd() });
    if (validateError !== null) {
        process.stderr.write(`\n  ${validateError.message}\n\n`);
        if (jsonOutput) {
            // usesteady-public#45 — same JSON enrichment as the JSON / batch
            // surface above. See `requestedOccurrenceForJsonError` JSDoc.
            const requestedOcc = requestedOccurrenceForJsonError(validateError);
            const payload = { success: false, error: validateError.code };
            if (requestedOcc !== undefined)
                payload["requested_occurrence"] = requestedOcc;
            process.stdout.write(JSON.stringify(payload) + "\n");
        }
        process.exit(1);
    }
    // 3. Convert IR → DraftTask → SpecTask, branching on create_dir.
    const { formatDraftTask, draftTaskToInput } = await import("./draft/intent-to-tasks.js");
    const { irOperationToJsonDraftTask } = await import("../../input/ir-to-draft.js");
    // Build parallel arrays (one entry per IR op) so preview and spec stay
    // index-aligned. `previewLine` is what the user sees; `specTask` is what
    // the workflow coordinator executes.
    const previewLines = [];
    const specTasks = [];
    ir.operations.forEach((op, i) => {
        if (op.type === "create_dir") {
            // Bypass the IR→DraftTask shim (it throws on create_dir per M2's
            // spare-wheel contract). Synthesize the workflow SpecTask directly
            // so the downstream coordinator sees operationType="create_dir".
            const rendered = `create folder ${formatPathTokenForDiagnostics(op.args.path)}`;
            previewLines.push(rendered);
            specTasks.push({
                input: rendered,
                label: `Step ${i + 1}`,
                operationType: "create_dir",
                targetFiles: [op.args.path],
            });
            return;
        }
        const task = irOperationToJsonDraftTask(op);
        previewLines.push(formatDraftTask(task));
        // F8-W4 / usesteady-public#45 — mirror an explicit occurrence
        // directive onto the SpecTask (diagnostics/render slot only;
        // executor unchanged). NL replace IR always carries
        // requestedOccurrence (R4); non-"first" directives are refused by
        // the validate stage before any approval surface renders, so only
        // "first" is ever displayed.
        specTasks.push({
            ...draftTaskToSpecTask(task, i, draftTaskToInput),
            ...(op.type === "replace" && op.args.requestedOccurrence !== undefined
                ? { requestedOccurrence: op.args.requestedOccurrence }
                : {}),
        });
    });
    // 4. Show pre-approval intake echo.
    // alpha.56 / F-A55-3: `[parsed]` glyph; explicit "not yet executed" wording.
    // F10-W2: each parsed step is followed by the decision-relevant detail
    // (canonical anchor + SYSTEM WILL preview content) BEFORE the single
    // plan-level approval below — same rendering truth, earlier lifecycle.
    if (!jsonOutput) {
        process.stdout.write("\n  Parsed your request into safe steps (not yet executed):\n\n");
        previewLines.forEach((line, i) => {
            process.stdout.write(`  [parsed] Step ${i + 1}: ${line}\n`);
            const detail = entryApprovalDetailLines(specTasks[i]);
            if (detail.length > 0)
                process.stdout.write(detail.join("\n") + "\n");
        });
    }
    // 5. Approval — identical surface to processJsonInput.
    let ans;
    if (autoYes || !isTTY) {
        if (!isTTY && !autoYes) {
            if (!jsonOutput) {
                process.stdout.write("\n  [non-interactive] Add --yes to execute these steps automatically.\n\n");
            }
            process.exit(0);
        }
        ans = "y";
        if (!jsonOutput) {
            process.stdout.write("\n  [--yes] Auto-approved.\n");
        }
    }
    else {
        // M5 §13 commit 2: NL one-shot approval via SessionController.
        ans = (await askApproval("\n  Approve these steps? (y/n): "))
            .trim()
            .toLowerCase();
    }
    if (ans !== "y" && ans !== "yes") {
        if (!jsonOutput)
            process.stdout.write("  Cancelled.\n" + frictionHintLine() + "\n");
        process.exit(0);
    }
    // 6. Build spec and execute via the same workflow path as run spec.json --yes.
    const spec = JSON.stringify({
        name: `NL: ${ir.operations.length} operation(s)`,
        tasks: specTasks,
        defaultRuntime: "cursor",
    });
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { writeFileSync } = await import("node:fs");
    const tmpSpec = join(tmpdir(), `usesteady-nl-${Date.now()}.json`);
    writeFileSync(tmpSpec, spec, "utf8");
    let resultPath;
    if (jsonOutput) {
        resultPath = join(tmpdir(), `usesteady-result-${Date.now()}.json`);
        process.env["USESTEADY_RESULT_PATH"] = resultPath;
    }
    const outcomePath = join(tmpdir(), `usesteady-outcome-${Date.now()}.json`);
    const outcomeToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.env["USESTEADY_WORKFLOW_OUTCOME_PATH"] = outcomePath;
    process.env["USESTEADY_WORKFLOW_OUTCOME_TOKEN"] = outcomeToken;
    const yesFlag = ["--yes"];
    process.argv = [process.argv[0], process.argv[1], "workflow", tmpSpec, process.cwd(), ...yesFlag];
    {
        // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
        // Dynamic import resolves on top-level evaluation, not on `main()`
        // settle. We must await the exported completion promise before
        // returning, otherwise the parent runs ahead and (in the workflow
        // sites here) reads the outcome file before the child writes it,
        // then `process.exit(1)` kills the still-running child mid-batch.
        const _main = await import("./main.js");
        await _main._runComplete;
    }
    const terminal = await readWorkflowTerminalOutcomeStrict(outcomePath, outcomeToken);
    if (!terminal.ok) {
        const msg = workflowOutcomeReadErrorMessage(terminal.error);
        if (jsonOutput) {
            process.stdout.write(JSON.stringify({ success: false, error: "execution_error" }) + "\n");
        }
        else {
            process.stderr.write(`\n  Error: ${msg}\n\n`);
        }
        process.exit(1);
    }
    if (jsonOutput && resultPath) {
        const ok = await emitJsonResult(resultPath);
        process.exit(ok ? 0 : 1);
    }
    process.exit(terminal.record.exitCode);
}
// Diagnostics-only quoting for the SpecTask.input string in create_dir case.
// The workflow coordinator uses operationType+targetFiles to execute; the
// input string is only for preview and logging. Quote whitespace paths so
// the rendered `create folder <path>` line is copy-pasteable.
function formatPathTokenForDiagnostics(p) {
    if (p.length === 0)
        return p;
    if (/\s/.test(p))
        return `"${p}"`;
    return p;
}
// ─── Entry point ─────────────────────────────────────────────────────────────
// S1 / friction #35 — `--help` and `--version` must:
//   1. never sample stdin (gated above via PURE_SUBCOMMANDS), and
//   2. exit deterministically even when the parent does not actively drain
//      our stdout pipe.
//
// The second requirement is the subtle one. `process.exit(0)` performs a
// synchronous flush of stdout/stderr before tearing the runtime down. On
// Windows, stdout connected to a pipe whose reader is slow can back up
// inside that synchronous flush, blocking the process indefinitely — the
// exact symptom reported on alpha.45 install probes (HELP_TEXT is ~5.6 KB,
// the default Windows pipe buffer is ~4 KB). The `writeAndExit` helper
// below hands the bytes to libuv first, then calls `process.exit(0)` from
// the write callback once the OS has accepted the write. We `await` a
// never-resolving promise so the rest of this top-level script does not
// race the async exit (the callback terminates the process; the awaited
// promise is purely a "park here" sentinel).
async function writeAndExit(text, code) {
    return new Promise(() => {
        process.stdout.write(text, () => process.exit(code));
    });
}
if (subcommand === "--help" || subcommand === "-h") {
    await writeAndExit(HELP_TEXT + "\n", 0);
}
if (subcommand === "--version" || subcommand === "-v") {
    // Resolve the package version by walking up from this file until we find
    // the `usesteady` package.json. Survives both layouts (src/shell/cli for
    // dev/tsx, dist/src/shell/cli for shipped tsc output) without hard-coding
    // depth. Falls back to "unknown" if (somehow) no package.json is found.
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    let version = "unknown";
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i += 1) {
        try {
            const raw = readFileSync(resolve(dir, "package.json"), "utf-8");
            const pkg = JSON.parse(raw);
            if (pkg.name === "usesteady" && typeof pkg.version === "string") {
                version = pkg.version;
                break;
            }
        }
        catch { /* keep walking */ }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    await writeAndExit(`usesteady ${version}\n`, 0);
}
const sourceResolution = resolveDirectInputSource({
    hasPrompt: promptFlag !== null,
    hasJson: jsonFlag !== null,
    hasStdin: hasStdinSource,
    hasArgv: hasArgvDirectRequest,
    hasBatch: isBatchSubcommand,
});
if (!sourceResolution.ok) {
    failInputSourceConflict(sourceResolution.sources);
}
// ── Path 1: --prompt flag (highest priority, any environment) ─────────────────
// M4: NL surface routes through `processNLInput` (deterministic normalize,
// no legacy draft-parser fallback). `processDraftInput` remains in the file
// as a spare wheel per design §6.6.1 rule 1 — it is unreferenced from the
// hot path and will be deleted in M6 alongside the rest of the draft layer.
if (promptFlag !== null) {
    await processNLInput(normalizePromptText(promptFlag), autoYes, "prompt");
    process.exit(0);
}
// ── Path 1.5: --json flag (structured machine-to-machine input) ───────────────
if (jsonFlag !== null) {
    capture("session_started", {
        input_mode: "json_flag",
        execution_mode: autoYes ? "auto" : "draft",
        is_tty: isTTY,
    });
    await processJsonInput(jsonFlag, autoYes, "json");
    process.exit(0);
}
// ── Path 2: No subcommand + piped stdin → read and process ────────────────────
if (!subcommand && !isTTY) {
    if (!hasStdinSource) {
        process.stderr.write("\n  No input provided. Run 'usesteady --help' for usage.\n" + frictionHintLine() + "\n");
        process.exit(1);
    }
    await processNLInput(pipedStdinInput, autoYes, "stdin");
    process.exit(0);
}
// ── Path 3: No subcommand + TTY → guided onboarding ──────────────────────────
if (!subcommand) {
    capture("session_started", { input_mode: "interactive", execution_mode: "interactive", is_tty: isTTY });
    const root = process.cwd();
    process.argv = [process.argv[0], process.argv[1], "onboarding", root];
    {
        // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
        // Dynamic import resolves on top-level evaluation, not on `main()`
        // settle. We must await the exported completion promise before
        // returning, otherwise the parent runs ahead and (in the workflow
        // sites here) reads the outcome file before the child writes it,
        // then `process.exit(1)` kills the still-running child mid-batch.
        const _main = await import("./main.js");
        await _main._runComplete;
    }
    process.exit(0);
}
// ── Path 4: Known subcommands ─────────────────────────────────────────────────
if (subcommand === "setup") {
    // M5 §13 commit 6 (entry 9): the explicit `usesteady setup` subcommand
    // now runs through a one-shot SessionController instead of constructing
    // a local readline.Interface. This removes the last stand-alone
    // createInterface call-site for an interactive entry; after commit 7
    // (friction-report) the only remaining construction site outside the
    // controller is inside SessionController itself (§5.1 invariant 1).
    const { runSetupSubcommand } = await import("./claude-setup.js");
    const { SessionController } = await import("../../session/controller.js");
    const setupCtrl = new SessionController({
        mode: "one_shot",
        autoYes: false,
        terminal: isTTY,
    });
    try {
        await runSetupSubcommand(setupCtrl);
    }
    finally {
        setupCtrl.shutdown();
    }
    process.exit(0);
}
else if (subcommand === "report") {
    const { runReport } = await import("./friction-report.js");
    await runReport(rest);
    process.exit(0);
}
else if (subcommand === "batch") {
    // Batch mode: reads a JSON array from a file and converges into processJsonInput.
    const batchPath = rest[0];
    if (!batchPath) {
        process.stderr.write("\n  Error: batch requires a file path\n" +
            "  Usage: usesteady batch operations.json --yes\n\n");
        process.exit(2);
    }
    let batchRaw;
    try {
        const { readFileSync } = await import("node:fs");
        batchRaw = readFileSync(batchPath, "utf8");
    }
    catch {
        process.stderr.write(`\n  Error: could not read batch file: ${batchPath}\n` + frictionHintLine() + "\n");
        process.exit(2);
    }
    capture("session_started", {
        input_mode: "batch",
        execution_mode: autoYes ? "auto" : "draft",
        is_tty: isTTY,
    });
    await processJsonInput(batchRaw, autoYes, "batch");
    process.exit(0);
}
else if (subcommand === "admin") {
    const [adminSub, ...adminArgs] = rest;
    if (adminSub === "friction") {
        try {
            // @ts-ignore — internal ops package, not in public release
            const { runAdmin } = await import("./friction-admin.js");
            await runAdmin(["friction", ...adminArgs]);
        }
        catch {
            process.stderr.write("\n  usesteady admin requires the Shortgigs ops package.\n" +
                "  This is an internal tool -- not available in the public release.\n\n");
            process.exit(1);
        }
        process.exit(0);
    }
    else {
        process.stderr.write(`\n  Unknown admin subcommand: "${adminSub ?? ""}". Try: usesteady admin friction\n\n`);
        process.exit(1);
    }
}
else if (subcommand === "replay") {
    // PR-K1 (kernel v1): verification-only artifact integrity check.
    // Recomputes sha256(stableStringify({ ir, result })) from the stored fields
    // and compares against the artifact's own checksum. No workflow execution.
    //
    // PR-K4: with --execute, additionally re-runs the IR in a fresh sandbox
    // and compares the resulting KernelResult to the artifact's stored result.
    // Default behavior (no flag) is byte-for-byte unchanged from K1 (K4-I1).
    // PR-K5 (v1.0): --execute additionally supports in-scope `run_command`
    // tasks (echo <args> / true / false). Out-of-scope commands refuse with
    // reason "non_deterministic_command".
    // PR-K6 (v1.0): --execute additionally supports `node -e "<BODY>"` where
    // BODY is in the K6 closed inline-JS allow-list. Out-of-scope BODYs refuse
    // with reason "non_deterministic_inline_js".
    // K1/K4-I8 byte-for-byte unchanged: stdout/stderr are observed but never
    // written into KernelResult.
    // See docs/KERNEL_EXECUTION_REPLAY_DESIGN.md section 11
    //     docs/KERNEL_RUN_COMMAND_DETERMINISM_DESIGN.md (K5 v1.0)
    //     docs/KERNEL_RUN_COMMAND_K6_DESIGN.md         (K6 v1.0).
    const artifactPath = rest[0];
    const wantsExecute = rest.includes("--execute");
    if (!artifactPath || artifactPath.startsWith("--")) {
        process.stderr.write("\n  Error: replay requires an artifact path\n" +
            "  Usage: usesteady replay <artifact-file> [--execute]\n\n");
        process.exit(2);
    }
    if (wantsExecute) {
        try {
            const { runExecutionReplay } = await import("../../kernel/execution-replay.js");
            const verdict = await runExecutionReplay(artifactPath);
            process.stdout.write(JSON.stringify(verdict) + "\n");
            const exit = verdict.replay === "match" ? 0 :
                verdict.replay === "mismatch" ? 1 :
                    verdict.replay === "refused" ? 3 :
                        2;
            process.exit(exit);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`\n  Error: ${message}\n\n`);
            process.exit(2);
        }
    }
    try {
        const { runReplay } = await import("../../kernel/replay.js");
        const verdict = runReplay(artifactPath);
        process.stdout.write(JSON.stringify(verdict) + "\n");
        process.exit(verdict.replay === "match" ? 0 : 1);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\n  Error: ${message}\n\n`);
        process.exit(2);
    }
}
else if (subcommand === "capabilities") {
    // Product Capability Track §3.1 (docs/product/useability-and-guided-
    // execution-track.md). Read-only catalog of supported IR operations.
    // Never executes anything; never approves anything; cannot mutate state.
    // --output json is supported (exempt from the global --yes rule above,
    // because this path has no execution to gate).
    const wantsHelp = rest.includes("--help") || rest.includes("-h");
    if (wantsHelp) {
        process.stdout.write("\n  Usage: usesteady capabilities [--output json]\n" +
            "\n  Print a structured catalog of every IR operation this build\n" +
            "  supports. Read-only. Does not execute. Does not require --yes.\n" +
            "\n  Default output is human-readable text. With --output json the\n" +
            "  catalog is printed as a single JSON object on stdout.\n\n");
        process.exit(0);
    }
    const { renderCapabilitiesJson, renderCapabilitiesText } = await import("./capabilities.js");
    process.stdout.write(jsonOutput ? renderCapabilitiesJson() : renderCapabilitiesText());
    process.exit(0);
}
else if (subcommand === "quickstart") {
    // Product Capability Track onboarding slice. Pure read-only guided
    // text. Never executes anything, never approves anything, never reads
    // stdin. --output json is exempt from the global --yes rule above;
    // quickstart does not support a JSON shape today (the content is
    // purely human-facing orientation), but the subcommand is exempted at
    // the dispatcher level for parity with capabilities/templates.
    const wantsHelp = rest.includes("--help") || rest.includes("-h");
    if (wantsHelp) {
        process.stdout.write("\n  Usage: usesteady quickstart\n" +
            "\n  Print the first-5-minutes guide: discovery, templates, approval,\n" +
            "  and how to stop safely. Read-only. Does not execute. Does not\n" +
            "  require --yes.\n\n");
        process.exit(0);
    }
    const { renderQuickstartText } = await import("./quickstart.js");
    process.stdout.write(renderQuickstartText());
    process.exit(0);
}
else if (subcommand === "auth") {
    // Sprint F — entitlement cache bridge (visibility only; no gates).
    const { parseAuthArgs, renderAuthHelpText, runAuthCommand, } = await import("./entitlement-cache.js");
    if (rest.includes("--help") || rest.includes("-h")) {
        process.stdout.write(renderAuthHelpText());
        process.exit(0);
    }
    const parsed = parseAuthArgs(rest);
    if (parsed === "usage-error") {
        process.stderr.write("\n  Error: use `usesteady auth refresh|status|logout`\n\n");
        process.stderr.write(renderAuthHelpText());
        process.exit(2);
    }
    const unknownFlag = rest.some((tok) => tok.startsWith("-") && tok !== "--help" && tok !== "-h");
    if (unknownFlag) {
        process.stderr.write("\n  Error: unknown flag for `usesteady auth`\n\n");
        process.exit(2);
    }
    const result = await runAuthCommand(parsed);
    if (result.stdout)
        process.stdout.write(result.stdout);
    if (result.stderr)
        process.stderr.write(result.stderr);
    process.exit(result.exitCode);
}
else if (subcommand === "doctor") {
    // Product Capability K6 — docs/product/usesteady-doctor-design-v1.md.
    // Read-only environment / install readiness checks. Never executes,
    // never approves, never loads specs. Ephemeral D5 store probe only.
    const wantsHelp = rest.includes("--help") || rest.includes("-h");
    if (wantsHelp) {
        const { renderDoctorHelpText } = await import("./doctor.js");
        process.stdout.write(renderDoctorHelpText());
        process.exit(0);
    }
    if (jsonOutput) {
        process.stderr.write("\n  Error: usesteady doctor does not support --output json in v1\n\n");
        process.exit(2);
    }
    const hasPositional = rest.some((tok) => !tok.startsWith("-"));
    const unknownFlag = rest.some((tok) => tok.startsWith("-") && tok !== "--help" && tok !== "-h");
    if (hasPositional || unknownFlag) {
        process.stderr.write("\n  Error: unknown flag or argument for `usesteady doctor`\n\n");
        process.exit(2);
    }
    const { runDoctorChecks, renderDoctorText } = await import("./doctor.js");
    const { probeOllamaReachable } = await import("./ollama-probe.js");
    const { buildWorkflowHealthDiagnosticRecord } = await import("../../diagnostics/build.js");
    const ollamaProbe = await probeOllamaReachable(process.env);
    const checks = runDoctorChecks({ ollamaProbe });
    const workflowHealth = await buildWorkflowHealthDiagnosticRecord({
        env: process.env,
        probeIssuer: true,
    });
    process.stdout.write(renderDoctorText(checks, { ollamaProbe, workflowHealth }));
    process.exit(0);
}
else if (subcommand === "timeline") {
    // Product Capability K6+1 / K7 — timeline v1 + v1.1 design docs.
    // Read-only chronological view of one terminal workflow run. Never executes,
    // never resumes, never parses live-runs or RunTimeline.
    const { parseTimelineArgs, runTimeline } = await import("./timeline.js");
    const { renderTimelineHelpText } = await import("../timeline-render.js");
    if (rest.includes("--help") || rest.includes("-h")) {
        process.stdout.write(renderTimelineHelpText());
        process.exit(0);
    }
    const parsed = parseTimelineArgs(rest);
    if (parsed === "usage-error") {
        process.stderr.write("\n  Error: use `usesteady timeline --last` or `usesteady timeline --run-id <id>`\n\n");
        process.exit(2);
    }
    if (parsed.mode === "help") {
        process.stdout.write(renderTimelineHelpText());
        process.exit(0);
    }
    const result = runTimeline(parsed, undefined, jsonOutput ? "json" : "text");
    if (jsonOutput) {
        process.stdout.write(result.json ?? "");
    }
    else {
        process.stdout.write(result.text ?? "");
    }
    process.exit(result.exitCode);
}
else if (subcommand === "reconstruct") {
    const { parseReconstructArgs, runReconstruct } = await import("./reconstruct.js");
    const { renderReconstructHelpText } = await import("../reconstruct-render.js");
    if (rest.includes("--help") || rest.includes("-h")) {
        process.stdout.write(renderReconstructHelpText());
        process.exit(0);
    }
    const parsed = parseReconstructArgs(rest);
    if (parsed === "usage-error") {
        process.stderr.write("\n  Error: use `usesteady reconstruct <ucp_root_id>`\n\n");
        process.exit(2);
    }
    if (parsed.mode === "help") {
        process.stdout.write(renderReconstructHelpText());
        process.exit(0);
    }
    const result = runReconstruct(parsed, undefined, jsonOutput ? "json" : "text");
    if (jsonOutput) {
        process.stdout.write(result.json ?? "");
    }
    else {
        process.stdout.write(result.text ?? "");
    }
    process.exit(result.exitCode);
}
else if (subcommand === "audit") {
    // P0-3 export + P3 summary — read-only store projections.
    const wantsHelp = rest.includes("--help") || rest.includes("-h");
    const auditVerb = rest.find((tok) => !tok.startsWith("-") && tok !== "--help" && tok !== "-h");
    if (wantsHelp && auditVerb === undefined) {
        const { renderAuditCommandHelpText } = await import("./audit-summary.js");
        process.stdout.write(renderAuditCommandHelpText());
        process.exit(0);
    }
    if (auditVerb === "summary") {
        const { parseAuditSummaryArgs, runAuditSummary, renderAuditSummaryHelpText, renderAuditSummaryUsageError, } = await import("./audit-summary.js");
        const summaryArgv = rest.filter((tok) => tok !== "summary");
        if (wantsHelp) {
            process.stdout.write(renderAuditSummaryHelpText());
            process.exit(0);
        }
        const parsed = parseAuditSummaryArgs(summaryArgv);
        if (parsed === "usage-error") {
            process.stderr.write(renderAuditSummaryUsageError());
            process.exit(2);
        }
        const result = runAuditSummary(parsed, undefined, jsonOutput ? "json" : "text");
        process.stdout.write(result.stdout);
        process.exit(result.exitCode);
    }
    const { parseAuditExportArgs, runAuditExport, renderAuditExportHelpText, renderMissingRunIdError, } = await import("./audit-export.js");
    if (rest.length === 0) {
        const { renderAuditCommandHelpText } = await import("./audit-summary.js");
        process.stdout.write(renderAuditCommandHelpText());
        process.exit(0);
    }
    const auditOutputMode = fileOutput ? "file" : jsonOutput ? "json" : null;
    const parsed = parseAuditExportArgs(rest, auditOutputMode);
    if (parsed === "usage-error") {
        process.stderr.write(renderMissingRunIdError());
        process.exit(2);
    }
    if (parsed.mode === "help") {
        process.stdout.write(renderAuditExportHelpText());
        process.exit(0);
    }
    const result = runAuditExport(parsed);
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
}
else if (subcommand === "usage") {
    // P2 — read-only local usage summary from usage-events.jsonl.
    const { parseUsageArgs, runUsageCommand, renderUsageHelpText, } = await import("./usage-summary.js");
    if (rest.includes("--help") || rest.includes("-h") || rest.length === 0) {
        process.stdout.write(renderUsageHelpText());
        process.exit(rest.length === 0 ? 2 : 0);
    }
    const parsed = parseUsageArgs(rest);
    if (parsed === "usage-error") {
        process.stderr.write("\n  Error: use `usesteady usage summary`\n\n");
        process.exit(2);
    }
    const result = runUsageCommand(parsed);
    process.stdout.write(result.stdout);
    if (result.stderr.length > 0)
        process.stderr.write(result.stderr);
    process.exit(result.exitCode);
}
else if (subcommand === "templates") {
    // Product Capability Track section 3.2. Read-only catalog of safe
    // starter workflows. Never executes anything; never approves anything;
    // cannot mutate state. Printing a template does NOT run it -- the
    // operator copies the JSON, customizes values, and runs the result
    // through the standard approval flow.
    //
    // Forms supported:
    //   usesteady templates                       -- list
    //   usesteady templates --output json         -- list as JSON
    //   usesteady templates <name>                -- detail for <name>
    //   usesteady templates <name> --output json  -- detail as JSON
    //   usesteady templates --help                -- subcommand help
    const wantsHelp = rest.includes("--help") || rest.includes("-h");
    if (wantsHelp) {
        process.stdout.write("\n  Usage: usesteady templates [<name>] [--output json]\n" +
            "\n  With no name: list every starter template with a one-line\n" +
            "  purpose. With a name: print the full template body (purpose,\n" +
            "  required/optional fields, example values, safety notes, example\n" +
            "  operations).\n" +
            "\n  Read-only. Does not execute. Does not require --yes.\n\n");
        process.exit(0);
    }
    const { renderTemplatesListJson, renderTemplatesListText, renderTemplateDetailJson, renderTemplateDetailText, renderUnknownTemplateText, isKnownTemplateName, } = await import("./templates.js");
    // --output / --yes / --json have already been stripped from process.argv
    // (and therefore from `rest`) by the pre-parse logic at the top of this
    // file. The first non-flag token in `rest` is the template name; absence
    // means "print the list".
    const templateName = rest.find((a) => !a.startsWith("-"));
    if (templateName === undefined) {
        process.stdout.write(jsonOutput ? renderTemplatesListJson() : renderTemplatesListText());
        process.exit(0);
    }
    if (!isKnownTemplateName(templateName)) {
        process.stderr.write(renderUnknownTemplateText(templateName));
        process.exit(2);
    }
    const out = jsonOutput
        ? renderTemplateDetailJson(templateName)
        : renderTemplateDetailText(templateName);
    if (out === undefined) {
        process.stderr.write(renderUnknownTemplateText(templateName));
        process.exit(2);
    }
    process.stdout.write(out);
    process.exit(0);
}
else if (subcommand === "examples") {
    // Product Capability Track -- workflow invocation ergonomics. Pure
    // read-only catalog of the three invocation shapes (--json / batch /
    // run) the CLI accepts. Never executes anything; never approves
    // anything; cannot mutate state. Printing a pattern does NOT run it.
    // --output json is exempt from the global --yes rule above (no
    // execution to gate).
    const wantsHelp = rest.includes("--help") || rest.includes("-h");
    if (wantsHelp) {
        process.stdout.write("\n  Usage: usesteady examples [--output json]\n" +
            "\n  Print the three accepted workflow invocation shapes:\n" +
            "    1. --json for a single inline op,\n" +
            "    2. batch <file> for an array of ops,\n" +
            "    3. run <file> for a WorkflowSpec.\n" +
            "\n  For each: the command form, the JSON shape, when to use it,\n" +
            "  and a minimal copyable example. Read-only. Does not execute.\n" +
            "  Does not require --yes.\n\n");
        process.exit(0);
    }
    const { renderExamplesJson, renderExamplesText } = await import("./examples.js");
    process.stdout.write(jsonOutput ? renderExamplesJson() : renderExamplesText());
    process.exit(0);
}
else if (subcommand === "workflow") {
    // P7-min — Workflow Comprehension Surface.
    //
    // Read-only structural inspection of a WorkflowSpec file. Loads the
    // spec via the canonical `loadWorkflowSpecFromFile`, lowers each task
    // to an IR Operation, runs the canonical `validateOperation` per task
    // (no short-circuit), and prints a deterministic report. Does NOT
    // execute. Does NOT approve. Does NOT mutate the workspace.
    //
    // Design lock: docs/product/p7-min-workflow-inspect-design-v1.md.
    // --output json is exempt from the global --yes rule above (no
    // execution to gate).
    const verb = rest[0];
    const wantsWorkflowHelp = rest.includes("--help") || rest.includes("-h") || verb === "--help" || verb === "-h";
    if (verb === undefined || wantsWorkflowHelp) {
        process.stdout.write("\n  Usage: usesteady workflow <verb> [options]\n" +
            "\n  Verbs:\n" +
            "    inspect <spec.json>           Read-only structural inspection of a\n" +
            "                                  WorkflowSpec. Loads the spec, runs the\n" +
            "                                  canonical validator per task, and prints\n" +
            "                                  a deterministic report. Does NOT execute.\n" +
            "    resume-info <token.json>      Read-only inspection of a resume token.\n" +
            "                                  Validates the token against --spec and\n" +
            "                                  verifies each completed task against the\n" +
            "                                  current workspace. Does NOT execute.\n" +
            "\n  Options (for `inspect`):\n" +
            "    --workspace-root <dir>  Defaults to process cwd.\n" +
            "    --output json           Print the report as a single-line JSON object.\n" +
            "                            Exempt from --yes (inspect never executes).\n" +
            "    --help / -h             Show this help.\n" +
            "\n  Options (for `resume-info`):\n" +
            "    --spec <spec.json>      REQUIRED. Path to the workflow spec the token\n" +
            "                            was issued against.\n" +
            "    --workspace-root <dir>  Defaults to process cwd.\n" +
            "    --output json           Print the result as a single-line JSON object.\n" +
            "                            Exempt from --yes (resume-info never executes).\n" +
            "    --help / -h             Show this help.\n" +
            "\n  Exit codes:\n" +
            "    0  Inspection/resume-info succeeded (with or without findings).\n" +
            "    1  Token unreadable, malformed, or workspace mismatch.\n" +
            "    2  Spec unloadable, or bad invocation.\n\n");
        process.exit(0);
    }
    if (verb !== "inspect" && verb !== "resume-info") {
        process.stderr.write(`\n  Error: unknown workflow verb: ${verb}\n` +
            "  Run `usesteady workflow --help` for the list of verbs.\n\n");
        process.exit(2);
    }
    if (verb === "inspect") {
        // Parse `inspect` argv. Single positional <spec.json>, optional
        // --workspace-root <dir>. Reject extra positionals + unknown flags.
        let specPath;
        let workspaceRootOverride;
        for (let i = 1; i < rest.length; i++) {
            const tok = rest[i];
            if (tok === "--workspace-root") {
                const next = rest[i + 1];
                if (next === undefined) {
                    process.stderr.write("\n  Error: --workspace-root requires a directory path.\n\n");
                    process.exit(2);
                }
                workspaceRootOverride = next;
                i += 1;
                continue;
            }
            if (tok === "--output" || tok === "--yes" || tok === "-y") {
                // Already consumed by pre-parse; skip + skip value for --output.
                if (tok === "--output")
                    i += 1;
                continue;
            }
            if (tok.startsWith("--")) {
                process.stderr.write(`\n  Error: unknown flag for \`workflow inspect\`: ${tok}\n\n`);
                process.exit(2);
            }
            if (specPath !== undefined) {
                process.stderr.write("\n  Error: `workflow inspect` accepts at most one positional <spec.json>.\n\n");
                process.exit(2);
            }
            specPath = tok;
        }
        if (specPath === undefined) {
            process.stderr.write("\n  Error: `workflow inspect` requires a <spec.json> positional argument.\n" +
                "  Usage: usesteady workflow inspect <spec.json> [--workspace-root <dir>] [--output json]\n\n");
            process.exit(2);
        }
        const { inspectWorkflowSpec, renderInspectionJson, renderInspectionText } = await import("./workflow-inspect.js");
        const report = inspectWorkflowSpec({
            specPath,
            workspaceRoot: workspaceRootOverride ?? process.cwd(),
        });
        process.stdout.write(jsonOutput ? renderInspectionJson(report) : renderInspectionText(report));
        // Findings are content, not failure. Exit 2 only on load failure.
        process.exit(report.success ? 0 : 2);
    }
    // verb === "resume-info" — P2-min read-only resume-token inspection.
    //
    // Surface:
    //   usesteady workflow resume-info <token.json> --spec <spec.json>
    //     [--workspace-root <dir>] [--output json]
    //
    // Discipline: zero authority. Parses + validates + verifies. Never
    // executes, never approves, never writes a token.
    let tokenPath;
    let specPath;
    let workspaceRootOverride;
    for (let i = 1; i < rest.length; i++) {
        const tok = rest[i];
        if (tok === "--spec") {
            const next = rest[i + 1];
            if (next === undefined) {
                process.stderr.write("\n  Error: --spec requires a path.\n\n");
                process.exit(2);
            }
            specPath = next;
            i += 1;
            continue;
        }
        if (tok === "--workspace-root") {
            const next = rest[i + 1];
            if (next === undefined) {
                process.stderr.write("\n  Error: --workspace-root requires a directory path.\n\n");
                process.exit(2);
            }
            workspaceRootOverride = next;
            i += 1;
            continue;
        }
        if (tok === "--output" || tok === "--yes" || tok === "-y") {
            if (tok === "--output")
                i += 1;
            continue;
        }
        if (tok.startsWith("--")) {
            process.stderr.write(`\n  Error: unknown flag for \`workflow resume-info\`: ${tok}\n\n`);
            process.exit(2);
        }
        if (tokenPath !== undefined) {
            process.stderr.write("\n  Error: `workflow resume-info` accepts at most one positional <token.json>.\n\n");
            process.exit(2);
        }
        tokenPath = tok;
    }
    if (tokenPath === undefined) {
        process.stderr.write("\n  Error: `workflow resume-info` requires a <token.json> positional argument.\n" +
            "  Usage: usesteady workflow resume-info <token.json> --spec <spec.json> [--workspace-root <dir>] [--output json]\n\n");
        process.exit(2);
    }
    if (specPath === undefined) {
        process.stderr.write("\n  Error: `workflow resume-info` requires --spec <spec.json>.\n" +
            "  Usage: usesteady workflow resume-info <token.json> --spec <spec.json> [--workspace-root <dir>] [--output json]\n\n");
        process.exit(2);
    }
    const { runResumeInfo, renderResumeInfoText, renderResumeInfoJson } = await import("./workflow-resume-info.js");
    const result = runResumeInfo({
        tokenPath,
        specPath,
        workspaceRoot: workspaceRootOverride ?? process.cwd(),
    });
    if (jsonOutput) {
        const { json, exitCode } = renderResumeInfoJson(result);
        process.stdout.write(json);
        process.exit(exitCode);
    }
    else {
        const { lines, exitCode } = renderResumeInfoText(result);
        process.stdout.write(lines.join("\n") + "\n");
        process.exit(exitCode);
    }
}
else if (subcommand === "help") {
    process.stdout.write(HELP_TEXT + "\n");
    process.exit(0);
}
else if (subcommand === "run-workflow") {
    process.stderr.write("\n  Error: \"run-workflow\" is not a subcommand.\n\n" +
        "  Use:\n" +
        "    usesteady run <spec.json> [--yes] [--report-to-portal]\n\n" +
        "  Example:\n" +
        "    usesteady run workflow.json --yes --report-to-portal\n\n" +
        "  Portal env (base URL only, no /api/v1/runs):\n" +
        "    USESTEADY_PORTAL_RUNS_URL=https://usesteady-portal.vercel.app\n" +
        "    USESTEADY_PORTAL_TOKEN=<entitlement org_id>\n\n");
    process.exit(2);
}
else {
    // Known workflow subcommands → delegate to main.ts.
    const internalArg = subcommand === "run" ? "workflow" :
        subcommand === "history" ? "history" :
            null;
    if (internalArg !== null) {
        capture("session_started", {
            input_mode: "argv",
            execution_mode: internalArg === "workflow" ? "run" : "interactive",
            is_tty: isTTY,
        });
        // Re-add --yes if it was stripped during pre-parse, so main.ts sees it.
        const yesForward = autoYes ? ["--yes"] : [];
        // PR-K3: wire the `run` subcommand into the --output json result-file
        // plumbing. Pre-K3 the run/workflow delegate path never set
        // USESTEADY_RESULT_PATH, so `usesteady run missing.json --yes --output
        // json` exited with a human message on stderr and no machine JSON on
        // stdout — the one --output json parity gap explicitly approved for
        // K3. Mirror the draft-path lifecycle: allocate a temp result-file,
        // export it to main.ts via env, then project it to stdout with
        // emitJsonResult once delegation completes.
        let runResultPath;
        if (jsonOutput && internalArg === "workflow") {
            const { join } = await import("node:path");
            const { tmpdir } = await import("node:os");
            runResultPath = join(tmpdir(), `usesteady-run-result-${Date.now()}-${process.pid}.json`);
            process.env["USESTEADY_RESULT_PATH"] = runResultPath;
        }
        process.argv = [process.argv[0], process.argv[1], internalArg, ...rest, ...yesForward];
        {
            // S1 / friction #32 / #33 — see main.ts `_runComplete` doc.
            // Dynamic import resolves on top-level evaluation, not on `main()`
            // settle. We must await the exported completion promise before
            // returning, otherwise the parent runs ahead and (in the workflow
            // sites below) reads the outcome file before the child writes it,
            // then `process.exit(1)` kills the still-running child mid-batch.
            const _main = await import("./main.js");
            await _main._runComplete;
        }
        if (runResultPath) {
            const ok = await emitJsonResult(runResultPath);
            process.exit(ok ? 0 : 1);
        }
    }
    else {
        // R1 (M4, design §6.6.2) — multi-token positional NL is joined with
        // single spaces into a single NL string and fed to the normalizer.
        // Today `rest` is dropped at `use-steady.ts:1207-1209`, so
        // `usesteady rename a to b` reported "Unknown subcommand: rename"
        // despite being valid NL. M4 joins argv [2..] and routes through
        // `processNLInput`; the normalizer decides acceptance.
        //
        // When there are no tail tokens AND the single argv token doesn't
        // look like a request, preserve the legacy "Unknown subcommand"
        // hint so single-word typos still get the helpful message.
        const joined = rest.length > 0 ? [subcommand, ...rest].join(" ") : subcommand;
        const looksLikeRequest = rest.length > 0 || subcommand.includes(" ") || subcommand.length > 20;
        if (looksLikeRequest) {
            await processNLInput(joined, autoYes, "positional");
        }
        else {
            process.stderr.write(`\n  Unknown subcommand: "${subcommand}". Run "usesteady --help" for usage.\n` + frictionHintLine() + "\n");
            process.exit(2);
        }
    }
}
//# sourceMappingURL=use-steady.js.map