# Hero demo: multi-step refactor, inspect -> interrupt -> resume

The canonical "developer reality" flow. One narrative, under 90 seconds,
covers every operational claim the wedge makes:

1. AI proposes a 4-task repo change.
2. Operator inspects the plan **before any execution**.
3. Run starts; process is killed mid-flight after task 2.
4. The resume token is plainly visible on disk.
5. Operator runs `workflow resume-info` to verify the token (read-only).
6. Resume completes the workflow; tasks 1 and 2 are re-verified, not re-run;
   tasks 3 and 4 execute; no approvals are inherited.

**Watch it:**

[![Hero demo: multi-step refactor -> inspect -> interrupt -> resume](https://usesteady.dev/demo/hero/multistep-refactor.preview.svg)](https://usesteady.dev/demo/hero/multistep-refactor.svg)

- Animated SVG (loops in browser/README): [`multistep-refactor.svg`](../assets/hero/multistep-refactor.svg)
- Static preview: [`multistep-refactor.preview.svg`](../assets/hero/multistep-refactor.preview.svg)
- Asciinema source (operator can upload to asciinema.org for live playback):
  [`multistep-refactor.cast`](../assets/hero/multistep-refactor.cast)
- Plain-text session: [`multistep-refactor.session.txt`](../assets/hero/multistep-refactor.session.txt)
- Original spec the AI proposed: [`specs/docs-refactor.json`](specs/docs-refactor.json)
- Captured token: [`multistep-refactor.token.json`](../assets/hero/multistep-refactor.token.json)
- Captured resume-info report: [`multistep-refactor.resume-info.json`](../assets/hero/multistep-refactor.resume-info.json)


## Storyboard

| Beat | Visible moment | What it proves | Approx. timing |
|------|----------------|----------------|----------------|
| 1 | `usesteady workflow inspect spec.json --workspace-root <WS>` shows the 4-task plan and target tree | **Inspect before execution.** No LLM, no writes, no approval prompt. | 0 - 15s |
| 2 | `usesteady run spec.json <WS> --yes` starts; killed after task 2/4 | **Operator-approved run.** Approval is given by inspecting first; `--yes` proceeds. | 15 - 30s |
| 3 | `ls <WS>` shows files from completed tasks plus `.usesteady/resume-tokens/<id>.json`; `cat` reveals plain JSON | **Visible resume artifact on disk.** Not a hidden checkpoint, not a database. | 30 - 45s |
| 4 | `usesteady workflow resume-info <token>` reports `aggregate: clean`, lists 2 already-done verdicts | **Read-only verification.** Same checks the resume path runs, but executes nothing. | 45 - 60s |
| 5 | `usesteady run spec.json <WS> --yes --resume-from <token>` completes tasks 3 and 4; tasks 1 and 2 re-verified, not re-executed | **Resume without inherited authority.** Each "already-done" claim is checked against current disk state. | 60 - 80s |


## What this demo proves (and what it does NOT)

Proves:

- **Inspect before execution** -- the plan is fully readable before approval.
- **Operator-driven execution** -- approval is required up front, not assumed.
- **Survivability without hidden continuation** -- killed mid-run, the operator
  can resume from a visible token without inheriting anything they didn't see.
- **Verification before resume** -- `workflow resume-info` is read-only;
  the resume path itself re-verifies every "already-done" claim.

Does NOT prove (and does NOT pretend to):

- Anything about LLM-generated content quality (the spec is hand-authored).
- Autonomous continuation (there isn't any; every step is explicitly invoked).
- Hidden retry, background daemons, or in-flight task resurrection.
- Crash recovery beyond visible task boundaries.


## Reproduce

The session is fully deterministic. To rebuild from source:

```bash
# 1. Capture a fresh narrated session (writes .session.txt + .token.json + .resume-info.json)
node scripts/p2-hero-capture.mjs

# 2. Render assets (writes .svg, .preview.svg, .cast both canonical + marketing mirror)
node scripts/p2-render-demo-assets.mjs
```

No dependencies beyond Node 18+ and the local UseSteady CLI. No network, no LLM,
no telemetry. The capture script normalizes workspace paths to `<WS>` and
ASCII-folds glyphs so the session is byte-stable across machines.


## Why this is the canonical "developer reality" flow

The four survivability demos in `docs/demo/survivability/` each prove **one**
property in isolation: kill mid-run, diverged filesystem, non-idempotent
re-prompt, resume-info inspection.

This hero demo is the **composition** -- the real developer story where all
four properties show up in one continuous flow:

- Multi-step (4 tasks across 4 files): like a real refactor.
- Interrupted mid-stream: like a CI timeout, a Ctrl+C, a host crash.
- Token-driven resume: not "smart recovery", just plain JSON the operator can read.
- Verification before continuation: not "trust the past", but re-check against current disk.

That's the wedge: AI-assisted multi-step execution that survives interruption
without hidden continuation. Visible at every step. Operator-owned at every step.
