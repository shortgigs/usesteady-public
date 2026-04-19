# UseSteady

**Developer CLI for safe AI-assisted code changes.**

UseSteady sits between your AI tool and your filesystem.  
It shows you exactly what will run â€” before it runs.  
Nothing executes without your explicit approval.

```
npx usesteady
```

---

## The problem

AI coding tools can rename files, delete code, and run commands â€” often before you've fully read what they're about to do.

UseSteady adds a mandatory review layer:

```
  SYSTEM WILL

  1. Replace "Submit" â†’ "Continue"
     in src/components/Button.tsx

  RISK: LOW

  [a] Approve   [r] Reject
```

You see the exact change. You decide. Then it runs safely.

---

## How it works

```
Exact input  â†’  SYSTEM WILL  â†’  You approve  â†’  runs
Vague input  â†’  Guidance     â†’  You rewrite  â†’  SYSTEM WILL
Dangerous    â†’  Hard block   â†’  Stopped before any LLM sees it
```

**UseSteady will never guess and execute.**

---

## Install

```bash
# No install needed
npx usesteady

# Or install globally
npm install -g usesteady
```

Requires **Node.js 18+**.  
Optional: set `ANTHROPIC_API_KEY` for richer guidance on ambiguous inputs.

---

## Supported operations

| Command | Example |
|---|---|
| `replace` | `replace "Submit" with "Continue" in src/Button.tsx` |
| `rename` | `rename src/Button.tsx to src/PrimaryButton.tsx` |
| `create` | `create file src/utils/helpers.ts` |
| `delete` | `delete file src/legacy/old.ts` |
| `run` | `run npm test` |

Vague, compound, or dangerous inputs are blocked and explained â€” not silently executed.

---

## What it blocks

- Vague requests (`update the button text` â†’ asks which file)
- Compound requests (`rename X and update imports` â†’ one change at a time)
- Dangerous commands (`run rm -rf /`, `run sudo ...` â†’ hard block)
- Path traversal (`../../etc/passwd` â†’ blocked)

---

## Example session

```
$ npx usesteady

  UseSteady

  AI can propose changes.
  You approve before they run.

  Type your request:

> replace "Submit" with "Continue" in src/components/Button.tsx

â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  [Cursor] PREPARED
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  SYSTEM WILL

  1. Replace "Submit" â†’ "Continue"
     in src/components/Button.tsx

  RISK: LOW

  WHY
  Updates button label. Styling only, no logic affected.

  [a] Approve   [r] Reject

> a

  âœ“ Step approved â€” Button.tsx updated.
```

---

## Mental model

Like `git diff` â€” but for AI actions, before they execute.

---

## Links

- **Website**: [usesteady.dev](https://usesteady.dev)
- **Docs**: [usesteady.dev/docs](https://usesteady.dev/docs)
- **npm**: [npmjs.com/package/usesteady](https://www.npmjs.com/package/usesteady)
- **Demo**: [usesteady.dev/demo](https://usesteady.dev/demo)

---

## Category

Developer Tool Â· CLI Â· Software Engineering Â· AI Safety Â· Code Review

---

## License

Apache 2.0 â€” free to use, modify, and distribute.

Built by [Shortgigs LLC](https://usesteady.dev/about) Â· Contact: founder@shortgigs.io
