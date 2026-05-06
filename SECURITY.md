# Security Policy

UseSteady's security guarantees come from architectural constraints —
deny-by-default mutations, explicit operator approval, and a runtime
that executes only what was approved. We treat any failure of those
guarantees as a security issue.

## How to report

Send a private report to **founder@shortgigs.io** with:

- A clear description of the issue.
- The exact input or sequence that triggers it.
- The observed behavior, including the version (e.g. `alpha.51`).
- The expected behavior under the documented authority model.

Please do not open public issues for security reports. We acknowledge
receipt within 5 business days and follow up with a triage timeline.

For non-sensitive safety concerns or possible misuse vectors that do
not require private handling, the `Misuse / safety issue` template in
this repository is also acceptable.

## In scope

The following are treated as security issues regardless of severity:

- **Approval-gate bypass.** Any path that mutates the filesystem, the
  working tree, or the workflow log without the operator approving the
  exact step.
- **Runtime drift from approval.** The runtime executing anything other
  than what the operator approved.
- **Identity-target spoofing.** A request acting on a different file,
  path, or platform resource than the operator-visible identifier
  suggests (Unicode confusables, normalization mismatches, bidirectional
  overrides, homographs).
- **Replay divergence.** A previously-recorded run replaying to a
  different result than originally recorded.
- **Secret leakage.** Credentials, tokens, or keys appearing in logs,
  artifacts, error output, or any operator-visible surface.

## Out of scope

These are tracked as product issues, not security issues:

- Bugs in the marketing site that do not expose secrets or user data.
- Denial-of-service against a local CLI run on the operator's own
  machine.
- Abuse of third-party model providers (Anthropic, OpenAI, etc.) using
  the operator's own credentials.
- Behavior of unsupported runtimes (Node.js < 18, unsupported shells).
- Performance and ergonomics issues.

## What we will not do

- We will not ask reporters to delay public disclosure beyond the
  triage-and-fix window without an explicit reason.
- We will not silently fix security issues. Every fix lands with a
  changelog entry naming the class of failure and the affected versions.
- We will not run a paid bug bounty, and we will not offer rewards in
  exchange for a private report. Reporters who opt in are credited in
  the public friction log; that is the recognition program.

## Coordinated disclosure

If you have already disclosed an issue publicly, please email us anyway
so we can triage and respond in the same place reporters are looking.
