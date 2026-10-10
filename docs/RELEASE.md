# Release runbook — UseSteady alpha line

**Audience:** anyone (human or agent) publishing an alpha version of `usesteady` to npm.
**Scope:** alpha pre-release line (`0.1.0-alpha.N`). The `latest` dist-tag is intentionally **not** advanced by an alpha release.

## Why this runbook exists

Background: the [postmortem](#appendix-a--why-this-runbook-exists-postmortem-summary) at the end of this file documents that `usesteady@alpha` resolved to a stale `0.1.0-alpha.40` for 19 consecutive publishes (alpha.41 through alpha.59) because `npm publish` was treated as terminal evidence of a successful release. The registry was never queried to confirm what the registry actually said.

This runbook turns that lesson into a checklist: **every alpha release must verify registry truth and git-tag truth after publish, and the verification block must appear in the release report.** A release that does not produce a complete verification block is not a release; it is an unverified publish.

---

## Pre-publish (before `npm publish`)

These checks are already covered by `npm run release:gate` and the release-PR review. They are listed here for completeness; the meat of this runbook is the post-publish section.

- [ ] Release PR opened (one PR per alpha version).
- [ ] `npm run build` clean from a fresh `dist/`.
- [ ] `npm run release:gate` passes.
- [ ] No dependency drift since the prior alpha tag (only `package.json` version and `package-lock.json` self-version fields change).
- [ ] `CHANGELOG.md` `## Unreleased` heading replaced with `## 0.1.0-alpha.N — <scope>`.
- [ ] Release PR merged to `master` (chronic marketing/ui `npm audit` failures may require `--admin` per existing precedent; the **`Dependency integrity (root)`** check must still be green).

The release commit on `master` becomes the **target commit** referenced by every verification check below.

---

## Post-publish verification (MANDATORY — five checks)

These five checks **must run after every `npm publish --tag alpha`** and **must all pass** before the release is considered shipped. If any check fails, do not transition issue labels, do not consider the release shipped, and either re-run the publish or open a hygiene fix PR — do **not** paper over the failure.

The intent of each check is to detect a specific failure mode observed in the postmortem (Appendix A). The mode is named in each row.

### V1 — npm alpha dist-tag resolves to the published version

```bash
npm view usesteady@alpha version
```

**Required output:** exactly the version string in `package.json` (e.g., `0.1.0-alpha.60`).
**Fails if:** `npm publish` was invoked without `--tag alpha`, or with a typo'd tag, or the registry rejected the dist-tag move. **Catches failure mode F1** — the historical miss.

If this check fails and the version itself is on the registry but the tag did not move, recover by running:

```bash
npm dist-tag add usesteady@0.1.0-alpha.N alpha
```

…then re-run V1.

### V2 — full dist-tag map captured for the release report

```bash
npm view usesteady dist-tags --json
```

**Required output:** capture the JSON literally and paste it into the release report (see template below). The `alpha` entry must equal `package.json` version; `latest` must remain at its prior value (alpha releases do **not** advance `latest`).
**Fails if:** any unexpected dist-tag exists (e.g., `next`, `beta`, accidental human typo). **Catches failure mode F1** with an audit trail; ensures the verification is an artifact, not a transient terminal output.

### V3 — annotated git tag points at the release commit

```bash
git rev-parse v0.1.0-alpha.N^{commit}
git cat-file -t v0.1.0-alpha.N
```

**Required output:** the first command prints the merge-commit SHA of the release PR (i.e., the `master` HEAD as it stood when `npm publish` ran). The second command prints exactly `tag` (not `commit`).
**Fails if:** the tag is missing entirely (annotated tag never created), or the tag is lightweight (created with `git tag X` instead of `git tag -a X`), or the tag points at a stale commit. **Catches failure modes F2 and F3.**

### V4 — git tag exists on the remote

```bash
git ls-remote --tags origin v0.1.0-alpha.N
```

**Required output:** at least one ref line, including a `refs/tags/v0.1.0-alpha.N^{}` line for annotated tags (the dereferenced commit).
**Fails if:** the tag was created locally but `git push origin v0.1.0-alpha.N` was never run. **Catches a latent adjacent failure mode** (local-only tag) that has not yet occurred but would be invisible without this check.

### V5 — every check above appears in the release report

The release PR description (or merge commit body, or a follow-up comment on the release PR) must contain the **full verbatim output** of V1, V2, V3, and V4. Paraphrased confirmation is **not** acceptable. The point is auditability: anyone reading the release PR a month later must be able to see exactly what the registry and the tag refs said at publish time.

If V5 is missing, the release is incomplete even if V1–V4 passed locally; reopen the release PR (or post a verification comment on it) and paste the outputs.

---

## Release-report template (paste this into every release PR description or a release-PR comment)

The release report is the single source of truth for what was published. It must include all of the following fields. **No field may be omitted, paraphrased, or marked "n/a" without a written reason.**

```markdown
## Release report — 0.1.0-alpha.N

### Published artifact

| Field                  | Value                                              |
|------------------------|----------------------------------------------------|
| published version      | `0.1.0-alpha.N`                                    |
| npm `alpha` dist-tag   | `0.1.0-alpha.N` (must equal published version)     |
| npm `latest` dist-tag  | `<unchanged from prior release>`                   |
| tarball filename       | `usesteady-0.1.0-alpha.N.tgz`                      |
| tarball shasum         | `<sha1 from npm pack output>`                      |
| tarball integrity      | `sha512-<base64> from npm pack output`             |
| tarball size           | `<size from npm pack output>`                      |
| total files in tarball | `<count from npm pack output>`                     |

### Git tag

| Field                  | Value                                              |
|------------------------|----------------------------------------------------|
| tag ref                | `v0.1.0-alpha.N`                                   |
| tag object SHA         | `<git rev-parse v0.1.0-alpha.N>`                   |
| target commit SHA      | `<git rev-parse v0.1.0-alpha.N^{commit}>`          |
| tag type               | `tag` (annotated) — verified via `git cat-file -t` |
| remote tag verified    | yes (output of `git ls-remote --tags origin vX`)   |

### Verification outputs (verbatim)

V1: `npm view usesteady@alpha version`
<paste exact stdout>

V2: `npm view usesteady dist-tags --json`
<paste exact stdout>

V3a: `git rev-parse v0.1.0-alpha.N^{commit}`
<paste exact stdout>

V3b: `git cat-file -t v0.1.0-alpha.N`
<paste exact stdout — must be `tag`>

V4: `git ls-remote --tags origin v0.1.0-alpha.N`
<paste exact stdout — must show at least one ref line>
```

A release without a complete report is **not shipped**. Issue label transitions to `status/shipped` (per AGENTS.md) are only valid after a complete report is recorded on the release PR.

---

## Operational notes (Windows / TLS / slow-query)

### Windows TLS trust-store mismatch on `npm publish`

**Symptom:** `npm publish` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `unable to verify the first certificate`. The npm error message itself recommends `--use-system-ca`. This happens on Windows when bundled Node.js does not trust the corporate / system root CA bundle that npm's registry endpoint is signed against.

**Workaround (verified working in alpha.60 publish):**

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm publish --tag alpha
Remove-Item Env:NODE_OPTIONS
```

The same flag is needed for the post-publish verification commands (`npm view ...`) when run in the same shell session, because they hit the same registry endpoint.

**Do not** disable TLS verification (`NODE_TLS_REJECT_UNAUTHORIZED=0`) as a workaround — that would publish over an unverified connection.

### Slow registry queries

`npm dist-tag ls usesteady` and `npm view usesteady ...` have been observed to take **upwards of 140 seconds** to complete in some sessions (vs. ~2 seconds in others). This is a registry-side latency variance, not a local issue.

**Why it matters for hygiene:** a verification step that hangs for two minutes invites the operator to skip it under deadline pressure. **Do not skip it.** If queries are slow:

- Set a generous timeout (e.g., `--fetch-timeout=60000`) and wait.
- If the query truly hangs, abort and retry — but do **not** publish until V1 and V2 have actually returned.
- If V1 cannot be confirmed within a reasonable retry window, the release is **incomplete**, not "good enough." Open a hygiene issue on the release PR and resolve before transitioning labels.

### "publish succeeded" is not "release succeeded"

The single most important operational lesson from the postmortem: an `npm publish` command exiting 0 means a tarball was uploaded. It does **not** mean the dist-tag moved, the version is resolvable via `@alpha`, the git tag was created, or the git tag was pushed. Those are separate facts, and each must be checked separately.

---

## Issue label transition (post-publish, per AGENTS.md)

After (and only after) V1–V5 are all green and the report is recorded:

- Friction issues that closed in this release: `status/accepted` → `status/shipped`.
- Issues still open: add `status/shipped` label and close (reason: completed).
- Shipping comment on each issue must reference: the released version (`0.1.0-alpha.N`), the install invocation (`npm install -g usesteady@alpha`), and the tracking PR.

Do not transition labels before the verification block is recorded. The label `status/shipped` claims an artifact exists; the verification block is the proof.

---

## Out of scope for this runbook (deliberate)

This runbook is documentation only. It deliberately does **not** include:

- A consolidated release script (e.g., `scripts/release-alpha.{sh,ps1}`). Proposed in the postmortem as G6; not implemented here. A future PR may add it.
- CI/workflow automation of any of V1–V5. Proposed in the postmortem as part of G1/G2; not implemented here. A future PR may add it.
- Backfill of missing git tags for alpha.41–alpha.46 and alpha.54–alpha.58. Proposed in the postmortem as the optional hygiene plan; a separate authorized PR will handle the recent gap (alpha.54–alpha.58) when ready.

These omissions are intentional: this PR exists to make future releases fail visibly if dist-tag or git-tag parity drifts again. Automation and history-backfill are separate concerns and will get separate PRs.

---

## Appendix A — Why this runbook exists (postmortem summary)

A full postmortem was produced on 2026-05-15 covering releases alpha.41 through alpha.60. Headline findings:

- **F1 (high, user-facing):** the npm `alpha` dist-tag was stuck at `0.1.0-alpha.40` for 19 consecutive publishes. `npm install -g usesteady@alpha` resolved to stale code from alpha.41 publish through alpha.59 publish. Corrected by the alpha.60 publish (now resolves to `0.1.0-alpha.60`).
- **F2 (medium, traceability):** annotated git tags were missing for alpha.41–.46 and alpha.54–.58 (11 versions on the registry, no corresponding tag).
- **F3 (low, metadata):** alpha.47 and alpha.48 were tagged lightweight instead of annotated.
- **F4 (low, truthfulness):** `package-lock.json` root `"version"` was frozen at `0.1.0-alpha.53` through alpha.54–alpha.59 (corrected at alpha.60).
- **F5 (systemic):** no post-publish registry check existed. `npm publish` success was treated as terminal.

All packages alpha.40–alpha.60 are present on the registry as numbered versions, so direct version installs (`npm install -g usesteady@0.1.0-alpha.N`) were unaffected. The `latest` dist-tag was correctly never advanced (alpha versions do not bump `latest`).

The five mandatory checks (V1–V5) above are the minimal guardrail set that would have caught F1, F2, and F3 at the publish step.
