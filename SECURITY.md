# Security

## Security notice - Windows junction/reparse paths

usesteady@0.1.0-alpha.72 has a known containment issue on Windows when a path inside the workspace traverses a junction/reparse point to a location outside the workspace.

UseSteady may display the apparent in-workspace path in SYSTEM WILL while the filesystem operation resolves outside the workspace.

Until a hardened release is available:

- do not use mutation commands on untrusted Windows repositories or workspaces containing junctions/reparse points;
- inspect/remove unexpected junctions before approving filesystem mutations;
- use .72 only in workspaces whose filesystem topology you control.

This issue does not bypass the interactive approval gate. It affects where an approved filesystem operation may ultimately land.

The released .72 artifact remains the object under independent review. We are not replacing it with an older version while the review is in progress.

## Report a vulnerability

Report vulnerabilities or misuse privately to support@usesteady.dev.

Do not file public issues for unreleased vulnerabilities.

Include:

- What you observed
- How to reproduce it
- Affected command or package version, if known
