# UseSteady

**Developer CLI that shows SYSTEM WILL before filesystem changes on the interactive path.**

UseSteady sits between your AI tool and your filesystem.  
It shows you exactly what will run - before it runs.  
Interactive steps wait for approval. `--yes` skips per-step prompts for a pre-reviewed spec.

```bash
# Interactive
npx usesteady

# Windows PowerShell / any shell - explicit input
npx usesteady --prompt "replace 'Submit' with 'Send' in src/Button.tsx first occurrence"

# Piped stdin
echo "rename old.ts to new.ts" | npx usesteady

# CI / automation - zero prompts
npx usesteady run spec.json --yes
```

---

## The problem

AI coding tools can rename files, delete code, and run commands - often before you've fully read what they're about to do.

UseSteady adds a review layer on the interactive path:

```
  SYSTEM WILL

  1. Replace "Submit" -> "Continue"
     in src/components/Button.tsx

  [a] Approve   [r] Reject
```

You see the declared operation and target. You decide. Then it runs. File writes, appends and prepends may also create missing parent directories.

---

## How it works

```
Exact input  ->  SYSTEM WILL  ->  You approve  ->  runs
Vague input  ->  Guidance     ->  You rewrite  ->  SYSTEM WILL
Dangerous    ->  Hard block   ->  Stopped before any LLM sees it
```

**Vague input is not executed as SYSTEM WILL. `--yes` still runs a pre-reviewed spec without per-step prompts.**

---

## Install

```bash
# No install needed
npx usesteady

# Or install globally
npm install -g usesteady
```

### One path per environment

| Environment | Command |
|---|---|
| Interactive | `npx usesteady` |
| Windows PowerShell | `npx usesteady --prompt "replace 'X' with 'Y' in file first occurrence"` |
| macOS / zsh | `npx usesteady --prompt 'replace "X" with "Y" in file first occurrence'` |
| Piped stdin | `echo "rename old.ts to new.ts" \| npx usesteady` |
| CI / scripts | `npx usesteady run spec.json --yes` |

```bash
```

Requires **Node.js 18+**.  
Optional: set `ANTHROPIC_API_KEY` for richer guidance on ambiguous inputs.

---

## Supported operations

| Command | Example |
|---|---|
| `replace` | `replace "Submit" with "Continue" in src/Button.tsx first occurrence` |
| `rename` | `rename src/Button.tsx to src/PrimaryButton.tsx` |
| `create` | `create file src/utils/helpers.ts` |
| `delete` | `delete file src/legacy/old.ts` |
| `run` | `run npm test` |

Vague, compound, or dangerous inputs are blocked and explained - not silently executed.

---

## What it blocks

- Vague requests (`update the button text` -> asks which file)
- Compound requests (`rename X and update imports` -> one change at a time)
- Dangerous commands (`run rm -rf /`, `run sudo ...` -> hard block)
- Path traversal (`../../etc/passwd` -> blocked)

---

## Example session

```
$ npx usesteady

  UseSteady

  AI can propose changes.
  You approve before they run.

  Type your request:

> replace "Submit" with "Continue" in src/components/Button.tsx first occurrence

----------------------------------------
  [Cursor] PREPARED
----------------------------------------

  SYSTEM WILL

  1. Replace "Submit" -> "Continue"
     in src/components/Button.tsx

  WHY
  Updates button label. Styling only, no logic affected.

  [a] Approve   [r] Reject

> a

  OK Step approved - Button.tsx updated.
```

Risk labels (LOW / MEDIUM / HIGH) appear only in the web-based execution
review view, where they are derived per step and gate batch approval. CLI
approval prompts show plain-language warnings (for example, deletion
permanence) instead of a risk label.

---

## Mental model

Like `git diff` - but for AI actions, before they execute.

---

## Links

- **Website**: [usesteady.dev](https://usesteady.dev)
- **Docs**: [usesteady.dev/docs](https://usesteady.dev/docs)
- **npm**: [npmjs.com/package/usesteady](https://www.npmjs.com/package/usesteady)
- **Demo**: [usesteady.dev/demo](https://usesteady.dev/demo)

---

## Category

Developer Tool | CLI | Software Engineering | Code Review

---

## License

Apache 2.0 - free to use, modify, and distribute.

Built by [Shortgigs LLC](https://usesteady.dev/about) | Contact: support@usesteady.dev
