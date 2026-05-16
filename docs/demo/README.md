# UseSteady - Demo Index

> **Inspect workflows before execution.**
> **Survive interruption without hidden continuation.**

This directory contains the canonical demos for UseSteady's operational primitives. Every capture is reproducible byte-for-byte from a deterministic script. No video required.

## Start here: the hero demo

[![Hero demo: multi-step refactor, inspect to interrupt to resume](https://usesteady.dev/demo/hero/multistep-refactor.preview.svg)](hero/)

**One narrative, ~80 seconds, five beats:** AI proposes a 4-task multi-file refactor; operator inspects the plan before any execution; run starts; process is killed mid-flight after task 2; operator inspects the visible resume token; operator runs `workflow resume-info` for read-only verification; resume completes the workflow with no inherited approvals.

See [`hero/`](hero/) for the full storyboard, walkthrough, and reproducible capture pipeline.

## The two primitive demo families

### [Workflow inspect](workflow-inspect/) - comprehension before execution

What `usesteady workflow inspect <spec.json>` does, on real workflows. Read-only. Deterministic. No LLM. No execution.

| Demo | What it shows |
|------|---------------|
| Repo refactor | A 5-task multi-file refactor; operation histogram + target tree |
| Staged migration | Sequenced rename + replace tasks with fs-dependent findings |
| Docs update | Pure write_file fan-out; static-only findings |
| Static findings | A spec that surfaces validator-time warnings before any execution |

See [`workflow-inspect/README.md`](workflow-inspect/) for the full set.

### [Survivability](survivability/) - resume without hidden continuation

What happens when a workflow is interrupted, and how UseSteady refuses to do anything sneaky about it.

| Demo | Proves | Badge |
|------|--------|-------|
| [01 - Kill mid-run, resume](survivability/01-kill-mid-run.md) | Workflow survivability | Survives interruption |
| [02 - Diverged filesystem, refusal](survivability/02-diverged-fs.md) | Integrity | Resume refused |
| [03 - Non-idempotent task, re-prompt](survivability/03-non-idempotent.md) | Authority discipline | Operator approval required |
| [04 - `resume-info` inspection](survivability/04-resume-info.md) | Visibility | Before execution |

See [`survivability/README.md`](survivability/) for the full set.

## What every demo guarantees

- **No hidden continuation.** Each demo prints what it does. The state it leaves behind is a plain file (or no file at all).
- **No execution during inspect.** `workflow inspect` and `workflow resume-info` are read-only commands. They never modify the workspace.
- **No approval inheritance.** A previous run's `--yes` does not transfer to today's resume. Every resumed run goes through approval again.
- **No mutation where not expected.** Demo 02 (divergence) and Demo 03 (non-idempotent) both refuse to proceed and leave the workspace untouched.
- **Same input, same output.** Captures are byte-stable: same spec + same workspace + same CLI -> same bytes.

## How to reproduce every asset

```bash
# Build the CLI.
npm install && npm run build

# Run all P7-min (workflow inspect) demo captures.
node scripts/p7-demo-capture.mjs

# Run all P2-min (survivability) demo captures.
node scripts/p2-survivability-capture.mjs
```

Each script uses isolated temp workspaces under `os.tmpdir()`. Nothing in this repo is modified. Path separators are normalized to forward slashes so the captures render identically on any host.

## What these demos are NOT

- They are not videos. Plain-text terminal captures live alongside walkthroughs in `assets/`. Use the captures as the storyboard for asciinema / MP4 / GIF recording.
- They are not benchmarks. They are not stress tests. They prove operational claims, not performance numbers.
- They are not autonomous agent demos. Every approval comes from the operator. Every resume is explicit.

## The two-line product pitch

> **UseSteady**
> Inspect workflows before execution.
> Survive interruption without hidden continuation.
