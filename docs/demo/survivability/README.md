# UseSteady — Survivability Demo Suite

> Inspect workflows before execution.
> Survive interruption without hidden continuation.

This directory contains four canonical demos that prove what "survivability without hidden continuation" looks like operationally. Each demo runs in under 60 seconds. Each one is reproducible byte-for-byte from a deterministic capture script (`scripts/p2-survivability-capture.mjs` in the engine repository); the captured assets shipped here are the output bytes.

## The four demos

| # | Demo | Proves | Walkthrough | Animated SVG | Asciicast | Preview |
|---|------|--------|-------------|--------------|-----------|---------|
| 01 | Kill mid-run → resume | Workflow survivability | [01-kill-mid-run.md](01-kill-mid-run.md) | [.svg](../assets/survivability/01-kill-mid-run.svg) | [.cast](../assets/survivability/01-kill-mid-run.cast) | [.preview.svg](../assets/survivability/01-kill-mid-run.preview.svg) |
| 02 | Diverged filesystem → refusal | Integrity | [02-diverged-fs.md](02-diverged-fs.md) | [.svg](../assets/survivability/02-diverged-fs.svg) | [.cast](../assets/survivability/02-diverged-fs.cast) | [.preview.svg](../assets/survivability/02-diverged-fs.preview.svg) |
| 03 | Non-idempotent task → re-prompt | Authority discipline | [03-non-idempotent.md](03-non-idempotent.md) | [.svg](../assets/survivability/03-non-idempotent.svg) | [.cast](../assets/survivability/03-non-idempotent.cast) | [.preview.svg](../assets/survivability/03-non-idempotent.preview.svg) |
| 04 | `resume-info` inspection | Visibility | [04-resume-info.md](04-resume-info.md) | [.svg](../assets/survivability/04-resume-info.svg) | [.cast](../assets/survivability/04-resume-info.cast) | [.preview.svg](../assets/survivability/04-resume-info.preview.svg) |

Plus the original captured terminal sessions as plain text:
[01](../assets/survivability/01-kill-mid-run.session.txt) ·
[02](../assets/survivability/02-diverged-fs.session.txt) ·
[03](../assets/survivability/03-non-idempotent.session.txt) ·
[04](../assets/survivability/04-resume-info.session.txt)

### Asset formats

| Format | What it is | Best for |
|--------|------------|----------|
| `.session.txt` | Plain-text narrated terminal capture | Diffs, copy-paste, audit logs |
| `.svg` (animated) | SMIL-animated SVG terminal recording | Direct embed in GitHub READMEs and the marketing landing page; no JS, no binary |
| `.cast` | [asciinema v2](https://docs.asciinema.org/manual/asciicast/v2/) JSON | Upload to asciinema.org for live playback; or convert to MP4/GIF with `agg` / `asciicast2gif` |
| `.preview.svg` | Single-frame static SVG screenshot | Thumbnails, social previews, fast-loading embeds |
| `.token.json` / `.resume-info.json` | Machine-readable JSON snapshots | Inspect what the operator-visible artifacts look like |

## What "survivability without hidden continuation" means

Most AI tooling treats recovery as: restore hidden state, continue automatically, preserve context invisibly, inherit prior intent.

UseSteady refuses that model — and the refusal is the feature.

- **Resume is explicit.** You pass `--resume-from <token>`. Nothing automatic.
- **Approvals are never inherited.** A previous run's `--yes` does not transfer to today's resume.
- **Verification, not assumption.** Each "already-done" task is re-checked against current disk state. Divergence stops the resume.
- **Non-idempotent ops re-prompt.** A `run_command` that ran before requires the operator to opt in via `--reexecute-non-idempotent`; the default is abort.
- **The resume token is a visible file.** It lives at `<workspace>/.usesteady/resume-tokens/<runId>.json`. You can read it. You can delete it. Nothing in the background re-creates it.

## How to reproduce these demos

```bash
# Build the CLI.
npm install && npm run build

# 1. Capture the raw .session.txt + .token.json + .resume-info.json.
node scripts/p2-survivability-capture.mjs

# 2. Render the .session.txt files into .svg + .cast + .preview.svg.
node scripts/p2-render-demo-assets.mjs
```

Each demo uses a tiny isolated temp workspace under `os.tmpdir()`; nothing in this repo is touched. The renderer step is pure (text-in, text-out, no network); same input → identical bytes.

## What the demos do NOT do

- They do not call out to a network. Every byte in the captures was produced locally.
- They do not require an API key. No LLM calls.
- They do not record video. The session captures are plain text, deliberately so. To make a screencast (asciinema, MP4, GIF), point your recorder at the same commands the capture script runs and copy the layout. The captures are the script.

## The two-line product pitch

> **UseSteady**
> Inspect workflows before execution.
> Survive interruption without hidden continuation.
