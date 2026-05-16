# UseSteady — Workflow Inspect Demo Suite

> **Inspect workflows before execution.**

`usesteady workflow inspect <spec.json>` is the comprehension primitive. It reads a workflow specification and prints exactly what the workflow will touch — operation histogram, target tree, static findings, fs-dependent findings, and non-deterministic task markers. It runs no LLM, executes no tasks, and never modifies the workspace.

This directory is the public surface for that primitive's demo set. Spec files, walkthroughs, and captured terminal sessions live under [`docs/demo/`](../) and [`docs/demo/assets/`](../assets/).

## The demos

| Demo | Spec | Walkthrough | Captured outputs |
|------|------|-------------|------------------|
| Repo refactor | `docs/demo/specs/01-repo-refactor.json` | `docs/demo/01-repo-refactor.md` | `docs/demo/assets/01-repo-refactor.{text.txt, json.json, exit.txt}` |
| Staged migration | `docs/demo/specs/02-staged-migration.json` | `docs/demo/02-staged-migration.md` | `docs/demo/assets/02-staged-migration.{text.txt, json.json, exit.txt}` |
| Docs update | `docs/demo/specs/03-docs-update.json` | `docs/demo/03-docs-update.md` | `docs/demo/assets/03-docs-update.{text.txt, json.json, exit.txt}` |
| Static findings | `docs/demo/specs/04-static-findings.json` | `docs/demo/04-static-findings.md` | `docs/demo/assets/04-static-findings.{text.txt, json.json, exit.txt}` |

Each demo:

1. Sources a real workflow specification.
2. Runs `usesteady workflow inspect <spec>` (both text and `--output json` modes).
3. Captures the deterministic output to `assets/`.
4. Walks through what the output reveals, paragraph by paragraph.

## What each demo proves

- **No execution during inspect.** The workspace is never touched. Same workspace before and after the command.
- **Same input → same output.** Run the inspect command twice on the same spec; the captures are byte-identical.
- **No LLM.** The inspect path does not call out to a network. No API key needed.
- **Findings are explicit.** Static findings (validator-time) and fs-dependent findings (probe-time) are surfaced with typed reasons.
- **JSON shape is stable.** The `--output json` payload is sorted-key and shape-locked for machine consumers (CI, dashboards, audit pipelines).

## How to reproduce every asset

```bash
# Build the CLI.
npm install && npm run build

# Regenerate every workflow-inspect capture in docs/demo/assets/.
node scripts/p7-demo-capture.mjs
```

Each demo uses an isolated temp workspace. Path separators in the captures are normalized to forward slashes so the bytes render identically on any host.

## Expected behavior

| Step | Observable |
|------|-----------|
| Load spec | "Loaded spec: <name> (<n> task(s))" |
| Validation | Per-task lines: `[static] / [fs-dependent] / [non_deterministic]` |
| Operation histogram | Counts per `operationType` (`write_file`, `rename`, ...) |
| Target tree | Sorted listing of every path the workflow would touch |
| Exit code | `0` on successful inspection (regardless of findings); `1` on bad invocation or unloadable spec |

## What did NOT happen

- **No workspace mutation.** Inspect never writes, deletes, or renames any file.
- **No execution.** No `run_command`, no `claude` runtime, nothing.
- **No approval gate.** Inspect is zero-authority; it does not ask you to approve anything.
- **No state file.** Inspect leaves no token, no log, no `.usesteady/` directory.

## Pair with the survivability suite

`workflow inspect` covers "what will this workflow do before I run it." For "what happens when a workflow is interrupted and I want to resume it," see the [survivability demo suite](../survivability/).

Together they form the public product surface:

> **UseSteady**
> Inspect workflows before execution.
> Survive interruption without hidden continuation.
