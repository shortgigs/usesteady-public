# Security

## Windows junction/reparse containment

`usesteady@0.1.0-alpha.72` is an affected historical release. On Windows, an approved filesystem mutation can traverse a junction/reparse point from an apparent in-workspace path to a location outside the workspace.

`usesteady@0.1.0-alpha.73` corrected the tested Windows junction/reparse path. The `alpha` npm dist-tag currently resolves to `0.1.0-alpha.73`. A separate, confirmed hardlink alias-object defect affects existing-file mutations in that released package. The `.73` junction result remains valid, but `.73` is not a correction for the hardlink finding. No publicly verified successor for that separate finding is claimed here.

No upgrade command to the current `alpha` dist-tag is recommended as a correction for the separate hardlink finding. Assess the named risks before using `.73`.

For `0.1.0-alpha.72`:

- do not use mutation commands on untrusted Windows repositories or workspaces containing junctions/reparse points;
- inspect/remove unexpected junctions before approving filesystem mutations;
- treat `.72` as affected even though the interactive approval gate still applies.

The issue in `.72` does not bypass the interactive approval gate. It affects where an approved filesystem operation may ultimately land.

For `.73`, avoid existing-file mutation commands on untrusted workspaces containing hardlinks. Approval still applies, but does not repair the receiver-identity defect. Do not treat the current `alpha` dist-tag as a correction for this separate finding.

The `.73` successor was released only after Windows junction/reparse containment regression, cross-platform effect-decision checks, exact-package verification, and clean Linux/Windows installation proof completed. This remains a claim about that tested junction issue and release evidence. The later hardlink finding is distinct. Neither result is a universal filesystem-security or Production-readiness guarantee.

`0.1.0-alpha.72` remains documented as junction-affected; publishing `.73` did not retroactively change `.72`. `0.1.0-alpha.73` remains documented as hardlink-affected until a separately verified successor is public.

## Report a vulnerability

Report vulnerabilities or misuse privately to support@usesteady.dev.

Do not file public issues for unreleased vulnerabilities.

Include:

- What you observed
- How to reproduce it
- Affected command or package version, if known
