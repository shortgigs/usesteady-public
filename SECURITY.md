# Security

## Windows junction/reparse containment

`usesteady@0.1.0-alpha.72` is an affected historical release. On Windows, an approved filesystem mutation can traverse a junction/reparse point from an apparent in-workspace path to a location outside the workspace.

`usesteady@0.1.0-alpha.73` is now available as the hardened successor for this specific issue. The `alpha` npm dist-tag resolves to `0.1.0-alpha.73`.

Upgrade with:

```bash
npm install -g usesteady@alpha
```

For `0.1.0-alpha.72`:

- do not use mutation commands on untrusted Windows repositories or workspaces containing junctions/reparse points;
- inspect/remove unexpected junctions before approving filesystem mutations;
- treat `.72` as affected even though the interactive approval gate still applies.

The issue in `.72` does not bypass the interactive approval gate. It affects where an approved filesystem operation may ultimately land.

The `.73` successor was released only after Windows junction/reparse containment regression, cross-platform effect-decision checks, exact-package verification, and clean Linux/Windows installation proof completed. This is a claim about the tested containment issue and release evidence, not a universal filesystem-security or Production-readiness guarantee.

`0.1.0-alpha.72` remains documented as affected; publishing `.73` does not retroactively change `.72`.

## Report a vulnerability

Report vulnerabilities or misuse privately to support@usesteady.dev.

Do not file public issues for unreleased vulnerabilities.

Include:

- What you observed
- How to reproduce it
- Affected command or package version, if known
