# UseSteady

**Inspect workflows before execution.**
**Resume from a visible token. A previous run's approvals do not transfer.**

<p align="center">
  <a href="docs/demo/hero/">
    <img alt="Hero demo: AI proposes a 4-task refactor, operator inspects, run is killed mid-flight after task 2, operator verifies the resume token, then resumes - no inherited approvals." src="https://raw.githubusercontent.com/shortgigs/usesteady-public/main/docs/demo/assets/hero/multistep-refactor.svg" width="900" />
  </a>
</p>

<p align="center">
  <em>One narrative, ~80 seconds, five beats: <strong>inspect</strong> -> approve -> run -> <strong>interrupt</strong> -> verify token -> <strong>resume</strong>. See the <a href="docs/demo/hero/">storyboard</a>.</em>
</p>

UseSteady inspects a workflow, shows the exact SYSTEM WILL operation, and waits for approval before each interactive step. `--yes` and break-glass skip per-step prompts. When a long workflow gets interrupted - Ctrl+C, CI timeout, machine reboot - you resume from a visible token without inheriting prior approval.

```bash
# 1. Inspect a workflow before running it. Read-only. Deterministic. No LLM.
npx usesteady workflow inspect spec.json

# 2. Run it. After each task, a resume token is written to
#    <workspace>/.usesteady/resume-tokens/<runId>.json
npx usesteady run spec.json --yes

# 3. Resume after interruption. Structural checks; unverified tasks need opt-in.
#    Resume does not inherit prior approvals. Diverged disk state refuses.
npx usesteady run spec.json --yes --resume-from <token.json>

# 4. Inspect a resume token without running anything.
npx usesteady workflow resume-info <token.json> --spec spec.json
```

See the [survivability demo suite](docs/demo/survivability/) for four canonical scenarios - each isolates one property in 30-60 seconds. The [hero demo](docs/demo/hero/) composes all four into one continuous flow.

### Four survivability demos

Each tile prints the named operational path it illustrates directly into the terminal chrome - a 3-second-readable badge so you know what you are about to watch.

<table>
  <tr>
    <td align="center" width="50%">
      <a href="docs/demo/survivability/01-kill-mid-run.md">
        <img alt="Kill mid-run -> resume. Badge: Survives interruption." src="https://raw.githubusercontent.com/shortgigs/usesteady-public/main/docs/demo/assets/survivability/01-kill-mid-run.preview.svg" width="100%" />
      </a>
      <br />
      <strong>Kill mid-run -> resume</strong><br />
      <em>Survives interruption</em>
    </td>
    <td align="center" width="50%">
      <a href="docs/demo/survivability/02-diverged-fs.md">
        <img alt="Diverged filesystem -> refusal. Badge: Resume refused." src="https://raw.githubusercontent.com/shortgigs/usesteady-public/main/docs/demo/assets/survivability/02-diverged-fs.preview.svg" width="100%" />
      </a>
      <br />
      <strong>Diverged filesystem -> refusal</strong><br />
      <em>Resume refused</em>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <a href="docs/demo/survivability/03-non-idempotent.md">
        <img alt="Non-idempotent task -> re-prompt. Badge: Operator approval required." src="https://raw.githubusercontent.com/shortgigs/usesteady-public/main/docs/demo/assets/survivability/03-non-idempotent.preview.svg" width="100%" />
      </a>
      <br />
      <strong>Non-idempotent task -> re-prompt</strong><br />
      <em>Operator approval required</em>
    </td>
    <td align="center" width="50%">
      <a href="docs/demo/survivability/04-resume-info.md">
        <img alt="workflow resume-info inspection. Badge: Before execution." src="https://raw.githubusercontent.com/shortgigs/usesteady-public/main/docs/demo/assets/survivability/04-resume-info.preview.svg" width="100%" />
      </a>
      <br />
      <strong><code>workflow resume-info</code> inspection</strong><br />
      <em>Before execution</em>
    </td>
  </tr>
</table>

Click any tile for the walkthrough. Each demo also ships as an animated SVG (in-repo, GitHub-renders) and an [asciinema v2 `.cast`](https://docs.asciinema.org/manual/asciicast/v2/) source - upload to asciinema.org for live playback or convert to MP4/GIF with `agg` / `asciicast2gif`.

---

## The smaller, interactive surface

UseSteady also has an interactive single-step mode for proposing and reviewing individual edits - useful before you graduate to multi-task workflows.

```bash
# Interactive session
npx usesteady

# Explicit input - Windows PowerShell and zsh safe
npx usesteady --prompt "replace 'Submit' with 'Send' in src/Button.tsx first occurrence"

# Piped stdin
echo "rename old.ts to new.ts" | npx usesteady
```

---

## Why

AI tools can generate code, run commands, and modify files - often before you fully understand what will change.

UseSteady adds a review layer:

- **SYSTEM WILL** - the declared operation and target
- **WHY explanation** - what this does and why it was triggered
- **Approve / Reject** - per step, before anything runs

Risk labels are layer-scoped, not universal. LOW / MEDIUM / HIGH risk levels
are computed and shown only in the web-based execution review view, where they
are derived per step and gate batch approval. CLI approval prompts do not
display risk labels; they show plain-language warnings instead (for example,
that a deletion is permanent). The warning text and the execution-review risk
classification are separate mechanisms.

---

## How it works

Describe what you want to change. UseSteady shows it as one of these named operations, or asks you to rewrite it: **replace, rename, create, delete, or run.**

**Public alpha:** Exact operations are shown as SYSTEM WILL and run after approval. Ambiguous or multi-step requests are guided to a specific form before anything runs.

---

## Example

On first run, `npx usesteady` offers a guided walkthrough ("Try a quick
example") that demonstrates the approval loop on a canned example:

```
  SYSTEM WILL
  - Change button color in src/components/Button.tsx

  FILES AFFECTED: 1

  RISK: LOW
  This only changes styling. No logic or behavior is affected.

  WHY:
  The Button component is used across 3 pages.
  This will update its appearance consistently.

  [a] Approve   [r] Reject   [exit] Leave
```

The `RISK: LOW` line above is part of the walkthrough's canned demonstration.
In day-to-day CLI use, approval prompts show the exact operation, its target,
and plain-language warnings (for example, deletion permanence) - not a risk
label.

If your input is ambiguous, UseSteady asks you to make it specific first:

```
  > update the button text

----------------------------------------------------
  [Cursor] NOT EXECUTE
----------------------------------------------------
  Which file should this apply to?

  Try one of these:
  -> replace "Submit" with "Continue" in src/components/Button.tsx first occurrence
  -> rename Button.tsx to PrimaryButton.tsx
  -> replace "<current text>" with "<new text>" in <file> first occurrence
```

### How requests are handled

| Input type | What happens |
|---|---|
| Clear - exact file, value, path | Runs immediately after approval |
| Missing info - file or value not given | Asks a specific question |
| Ambiguous - could mean multiple things | Suggests a concrete rewrite |
| Too broad - large or multi-step scope | Asks you to break it down |

**Vague input is not executed as SYSTEM WILL; UseSteady asks for a more specific request.**

### Mental model

```
Exact input  ->  SYSTEM WILL  ->  You approve  ->  runs
Vague input  ->  Guidance     ->  You rewrite  ->  SYSTEM WILL
```

### Destructive operations

A delete on the CLI shows a plain-language permanence warning before the
approval prompt:

```
  Operation: delete (removes a file)
  Target:    src/utils/deprecated.ts
  File note: Deletion is permanent within this workspace; verify the path.
```

The web-based execution review view additionally classifies each step LOW /
MEDIUM / HIGH, derived from the operation and the files it touches. Delete
steps are classified HIGH there: they always require individual review and are
excluded from batch approval. The CLI warning text and the execution-review
risk classification are separate mechanisms.

---

## What makes it different

- Interactive steps are shown before they run. `--yes` and break-glass skip per-step prompts.
- No vague summaries
- Interactive SYSTEM WILL shows the exact operation
- Resume uses a visible token; a previous run's approvals do not transfer
- Resume does not inherit prior approvals

You see the declared operation and target before it runs. File writes, append, and prepend may also create missing parent directories; this is not a prediction of every host effect. Resume requires an explicit `--resume-from` invocation with a visible token (a plain JSON file in your workspace).

Resume checks path existence for completed writes, absence for deletes, source absence and destination presence for renames, and directory type for directory creation. These structural checks do not verify file bytes or object identity. Completed replace, append, prepend, run, and interpretive tasks require explicit `--reexecute-non-idempotent` opt-in because their effects are not verified. Despite the flag's name, it acknowledges those prior completions and advances past them; it does not reexecute them. Remaining tasks still follow the normal approval flow.

---

## What UseSteady is NOT

- **Not an autonomous agent.** UseSteady does not run when you are not watching. It does not "figure things out" in the background. It has no daemon, no watcher, no retry loop.
- **Not a code-generation tool.** UseSteady doesn't write the workflow for you. You describe it (or generate it with whatever tool you like), then UseSteady inspects, approves, runs, and resumes it.
- **Not a replacement for AI coding assistants.** Use Cursor, Claude, Copilot for the proposal layer. UseSteady is the layer that decides what their proposals are allowed to do to your filesystem.
- **Not a managed service.** UseSteady runs locally. Your workflows execute on your machine. The CLI may send optional product analytics if `POSTHOG_KEY` is set; otherwise those calls no-op. There is no UseSteady cloud workspace and no remote workflow state.
- **Not a workflow scheduler.** No cron, no triggers, no automatic invocation. The CLI runs when you run it.
- **Not "smart" about failures.** Resume refuses divergence detected by its supported structural checks and reports the failed check. It does not detect every workspace or content change. You decide how to reconcile it.

---

## How UseSteady differs from common alternatives

| | Autonomous coding agents | AI copilots / chat assistants | Workflow engines (Airflow, Temporal) | UseSteady |
|---|---|---|---|---|
| **Who decides what runs** | The agent | The IDE (after suggestion) | The scheduler | The operator, per step |
| **What "resume" means** | Restore hidden state, continue | n/a (single-prompt scope) | Resume from internal checkpoint | Structural token checks; refuse detected divergence; explicit opt-in for unverified classes |
| **Approval model** | Inherited or implied | Per-completion in IDE | Configuration-time only | Per-step on the interactive path; resume does not inherit prior approvals |
| **What you can inspect** | Logs, traces, agent reasoning | Diff in the IDE | DAG topology | The exact operations, the exact targets, the exact token bytes |
| **Where it runs** | Often cloud-managed | IDE host | Cluster | Your local machine |
| **What gets persisted** | Often hidden internal state | n/a | Engine-managed state stores | A visible JSON file in your workspace |
| **Failure mode** | Best-effort recovery | n/a (single shot) | DAG retry policy | Refuse on divergence; surface a typed reason |

UseSteady fits a different niche from any of these: long-horizon, multi-step, multi-operator AI-assisted changes whose **operational trust** is more important than autonomous sophistication.

---

## Install

```bash
# No install needed - run directly
npx usesteady

# Or install globally
npm install -g usesteady
```

Requires Node.js 18+. Runs fully local.

**AI execution is deterministic by default.** Grok-powered AI execution is opt-in via `USESTEADY_USE_GROK` (the primary AI path; set `XAI_API_KEY`). Claude remains available as a secondary opt-in via `USESTEADY_USE_CLAUDE` (set `ANTHROPIC_API_KEY`). With no AI flag set, UseSteady is fully functional and never calls a model. Interactive AI proposals wait for per-step approval. `--yes` and break-glass skip those prompts.

### One path per environment

| Environment | Command |
|---|---|
| Interactive (any) | `npx usesteady` |
| Windows PowerShell | `npx usesteady --prompt "replace 'X' with 'Y' in file first occurrence"` |
| macOS / zsh | `npx usesteady --prompt 'replace "X" with "Y" in file first occurrence'` |
| Piped stdin | `echo "rename old.ts to new.ts" \| npx usesteady` |
| CI / scripts | `npx usesteady run spec.json --yes` |

`--prompt` avoids shell quoting issues across environments. `--yes` collapses all approval prompts - use it only in CI where you've reviewed the spec.

---

## First 5 Minutes with UseSteady

This is the fastest path from a fresh install to a successful, reviewed change.

### 1. Read the orientation

```bash
npx usesteady quickstart
```

One screen. What UseSteady is, the steps below, plain-language approval, where workflows execute, how to stop. Read-only - this command does not run anything.

### 2. See what operations exist

```bash
npx usesteady capabilities
```

The full catalog of supported operations (`replace`, `append`, `rename`, `create`, etc.), with the exact JSON shape for each. Source of truth - no second list to drift against.

### 3. Pick a starter template

```bash
npx usesteady templates
```

Lists five safe, non-destructive starter workflows:

| Template | What it does |
|---|---|
| `append-to-file` | Add a block to an existing file (recommended first run). |
| `safe-rename` | Rename one file with explicit approval. |
| `multi-file-replace` | Same exact-text replacement across a hand-listed file set. |
| `non-destructive-cleanup` | Move files into a new directory via rename (no deletions). |
| `git-safe-review-flow` | Capture review notes in `REVIEW.md` without touching source. |

Print a template in detail:

```bash
npx usesteady templates append-to-file
```

You get the purpose, required fields, example values, safety notes, and a runnable JSON operation block.

### 4. Customize and run

Copy the JSON operations from the template into a file (e.g. `ops.json` - as a JSON array), replace the placeholder values with your real values, then:

```bash
npx usesteady batch ops.json
```

UseSteady prints **SYSTEM WILL** with the exact operation, waits for your approval, and only runs after you say yes. `--yes` and break-glass skip per-step prompts.

### What `SYSTEM WILL` looks like

For an `append-to-file` operation customized to add `hello from usesteady` to `NOTES.md`, the approval frame is:

```
----------------------------------------------------
  APPROVE?  Task 1 of 1
----------------------------------------------------
  SYSTEM WILL
  -> Append to NOTES.md
  You asked:  append "hello from usesteady" to NOTES.md
  Preview:
    Operation: append (text added to end of file)
    Target:    NOTES.md
    Content:   "hello from usesteady"
    File note: If NOTES.md does not exist, it will be created.

  Approve this task? (y/n)
```

The `Preview:` block is sourced from the same fields the executor uses. It tells you, before approval:

- the **operation** (factual label, not a paraphrase)
- the **target** file
- the literal **content** being written (quoted verbatim; truncated deterministically if long; tab/CR/newline rendered as `\t`/`\r`/`\n` so multi-line text cannot forge visual lines)
- the **file note** describing what happens if the file is missing (`will be created`) or already present (`will fail (target_exists)`, depending on the operation)

Nothing runs until you type `y`.

### 5. If you change your mind

At any approval prompt, choose **Reject** (or press `Ctrl+C`). The current operation is not applied; UseSteady exits. Operations approved earlier in the workflow are filesystem changes you already authorized one at a time; undo them via your version control (`git revert`) or by reversing the operation manually.

### Approval, in one sentence

By default UseSteady stops before every operation. Add `--yes` only when you have already read and reviewed the entire spec (typical in CI).

### Break-glass mode (audited operator escape hatch)

Break-glass mode is the one explicit, operator-controlled way to skip the per-step approval prompt for a workflow run. It exists for deliberate unattended execution - never as a default, and never silent.

- **Declared up front.** Break-glass is set when the run is created and cannot be turned on mid-run.
- **Reason required.** You must state why; the reason is recorded.
- The run is permanently marked as break-glass and written to the local history record.
- **Same boundaries.** Same workspace limits, same runtime, same execution seam as a normal run - only the per-step human prompt is removed.

Use it only when you are knowingly accepting that all steps will run without stopping for approval. If you are unsure, do not use it: run normally and approve each step.

---

## Discover what UseSteady can do

Print a structured catalog of every operation this build supports - read-only, never executes anything:

```bash
npx usesteady capabilities
```

Or machine-readable:

```bash
npx usesteady capabilities --output json
```

Sample (truncated):

```
  UseSteady supported operations:

  replace
      Replace <from> with <to> in <file>. The optional `occurrence` field
      declares intent only -- the executor does not yet honor occurrence
      selection: "first" passes validation, but execution still requires
      a unique match (multiple matches are refused, never selected);
      "all" and { index: N } are refused at validate stage. Tracked at
      usesteady-public#45.
      Required (IR): file, from, to
      Optional (IR): occurrence
      JSON example:  {"type":"replace","file":"src/Button.tsx","from":"old text","to":"new text","occurrence":"first"}

  rename
      Rename the file at <from> to <to>.
      Required (IR): from, to
      Optional (IR): (none)
      JSON example:  {"type":"rename","from":"old.ts","to":"new.ts"}
  ...
```

The catalog is sourced from the same registry the executor uses. No second source of truth, no documentation drift. Useful for: authoring `--json` and batch payloads, discovering supported operations, scripting validation.

---

## Workflow Shapes

UseSteady accepts three workflow invocation shapes. Pick the one that matches the JSON you have on hand:

| Shape | Command | When to use |
| --- | --- | --- |
| Single inline op | `usesteady --json '<op>' --yes` | One operation, typed at the command line. |
| Op array file | `usesteady batch <file> --yes` | A saved array of operations in a file. |
| WorkflowSpec file | `usesteady run <file>` | A named workflow with labeled tasks and NL inputs. |

Print the three patterns with minimal copyable JSON each:

```bash
npx usesteady examples
```

Or machine-readable:

```bash
npx usesteady examples --output json
```

Read-only; never executes anything. `run <file>` also auto-wraps a single JSON op or an op array, so a workflow file you keep on disk works the same way whichever shape you choose.

---

## Core idea

**AI proposes. Interactive steps wait for approval. Then the approved step runs. `--yes` and break-glass skip those prompts.**

Like `git diff` - but for AI actions before they execute.

---

## Language

| Term | Meaning |
|---|---|
| `SYSTEM WILL` | The declared operation and target; not a whole-host effect prediction |
| `SYSTEM SUGGESTS` | Options shown when AI is unsure - not a guess |
| `Approve` / `Reject` | Your decision, per step |
| `Revert last approval` | Undo a decision (not a filesystem change - nothing has run yet) |
| `Risk: LOW / MEDIUM / HIGH` | Execution review view (web) only - derived per step from what is actually changing; CLI approval prompts show plain-language warnings instead |

---

## You see SYSTEM WILL on the interactive path.

`--yes` and break-glass skip per-step prompts.

---

[usesteady.dev](https://usesteady.dev) | Apache 2.0 | Contact: support@usesteady.dev
