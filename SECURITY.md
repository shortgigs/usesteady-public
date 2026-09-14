# Security

## Current containment advisories

### `usesteady@0.1.0-alpha.72` — Windows junction/reparse issue

`usesteady@0.1.0-alpha.72` is an affected historical release. On Windows, an approved filesystem mutation can traverse a junction/reparse point from an apparent in-workspace path to a location outside the workspace.

For `.72`:

- do not use mutation commands on untrusted Windows repositories or workspaces containing junctions/reparse points;
- inspect/remove unexpected junctions before approving filesystem mutations;
- treat `.72` as affected even though the interactive approval gate still applies.

The issue in `.72` does not bypass the interactive approval gate. It affects where an approved filesystem operation may ultimately land.

### `usesteady@0.1.0-alpha.73` — hardlink alias-object issue

`.73` contains and passes the tested Windows junction/reparse regression that motivated the successor release. However, post-release characterization identified a separate containment gap for existing-file mutation paths when an in-workspace filename is a hardlink to the same filesystem object as another name outside the workspace.

For this hardlink alias-object class, an operation may name an in-workspace path while mutating the same underlying file object reachable through another pathname. The current `.73` effective-resource check does not make a hardlink a distinct resolved path, so path containment alone is insufficient for this case.

Until a successor is certified:

- treat `.73` as affected for hardlink alias-object containment on existing-file mutation paths;
- do not use UseSteady as a filesystem sandbox;
- do not run mutation workflows on untrusted repositories/workspaces where hardlinks or other unexpected filesystem aliases may be present;
- do not treat `--yes`, break-glass, or remote approval as a substitute for containment;
- prefer read-only inspection when the workspace provenance is not trusted.

The npm `latest` and `alpha` tags currently resolve to `0.1.0-alpha.73`. That distribution state does **not** mean the hardlink containment issue is closed.

There is currently no published version that we are presenting as a complete containment successor for both the historical junction issue and the newly identified hardlink alias-object issue.

`.72` remains documented as affected historical truth. `.73` remains useful evidence for the specific tested Windows junction regression, but it is not a universal filesystem-security or Production-readiness guarantee.

## Report a vulnerability

Report vulnerabilities or misuse privately to support@usesteady.dev.

Do not file public issues for unreleased vulnerabilities.

Include:

- What you observed
- How to reproduce it
- Affected command or package version, if known
