# Contributing to UseSteady

Thanks for taking the time to engage with UseSteady. This is the public
repository for friction reports, bug reports, feature requests, and
safety issues. The CLI itself is published to npm; this repo exists so
the conversation around it can be public, structured, and auditable.

This document is short on purpose. It covers what we expect from
contributions submitted here.

## What this repo is for

- **Friction reports** — anything in the CLI that felt confusing,
  surprising, broken, or slower than it should be. Real friction is
  more useful than polished bug reports.
- **Bug reports** — reproducible defects in published behavior.
- **Feature requests** — concrete proposals tied to a real workflow.
- **Misuse / safety issues** — unsafe behavior, policy bypass risk, or
  abuse vectors.

Each of those has a dedicated issue template. Please use them. They
exist because structured input gets triaged faster and gets more useful
follow-up.

## What UseSteady is, and how to keep proposals aligned

UseSteady is a governed execution runtime. The principle, in one
sentence:

> AI proposes. The operator approves. The runtime enforces.

Proposals that quietly weaken any of those three boundaries — letting
AI act without explicit operator approval, replacing approval with
heuristics, or moving enforcement out of the runtime — are unlikely to
land. Proposals that strengthen the boundaries, surface them more
clearly, or close gaps in them are very welcome.

## Filing an issue

When you open an issue, please:

- Use the right template (`Bug report`, `Feature request`, or
  `Misuse / safety issue`). Use `Misuse / safety issue` if you are
  unsure whether something is a bug or a safety concern.
- Keep the input verbatim. Do not paraphrase what UseSteady printed,
  paste the exact text. Paraphrased output makes triage harder and
  occasionally hides the actual defect.
- Include version (e.g. `usesteady@0.1.0-alpha.NN`), OS, and shell.
- For safety issues that you would not want public, please email
  **founder@shortgigs.io** instead. See `SECURITY.md`.

## Recognition

We credit contributors in the public friction log when they opt in to
public credit. That is the entire recognition program.

We do not run a paid bounty, a tier system, points, or any other
contributor compensation program. Reports are valued on their own
merits, not on a payout schedule.

## Conduct

Be respectful. Disagree with claims, not people. Report conduct
concerns to **founder@shortgigs.io**.

## Encoding and formatting

This repository is ASCII or UTF-8 without BOM. Please do not paste
content with smart quotes, em-dash homoglyphs, or zero-width characters
in titles, identifiers, or any operator-visible string. If your editor
auto-converts quotes, please paste in a plain-text view first.

## License

UseSteady is Apache 2.0. By opening an issue or proposing a change you
confirm that any text or content you submit can be used under the same
license.

## Code contributions

The CLI source lives in a separate repository. If you want to propose
a code change, open a friction report or feature request here first so
the change has a public, citable starting point. Code-level
contribution guidelines, the doctrine surface, and the rule registry
live in that repository, not here.
