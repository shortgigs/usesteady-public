# Changelog

## 0.1.0-alpha.74

- Refuses existing regular-file mutation receivers with multiple hardlink names before effect.
- Preserves the tested Windows junction/reparse containment regression and R0 authority boundaries.
- Release candidate only until exact artifact, independent review, registry readback, and clean-install proof complete.
- Bounded dependency correction (draft only; not publication): pin @anthropic-ai/sdk to first patched 0.91.1; exact-pin express to 4.22.3 so consumers receive Express's own qs ~6.16.0. The repository-only express.qs override from the prior candidate is removed. Identity remains 0.1.0-alpha.74.
- Packed-consumer proof now fail-closes unless npm audit finishes with status 0, no spawn error/signal, object JSON with no reported error, and an explicit metadata.vulnerabilities.total of 0. Missing or empty metadata is not treated as zero.

## 0.1.0-alpha.73 - Hardened successor release candidate

### Summary

Release-candidate identity for the R0 hardened-successor proof path. This entry records candidate metadata only; publication remains separately gated by #1072 and requires explicit release authority.

### What changed

- Carries the bounded Windows junction containment hardening exercised by the #1072 release-security regression.
- Preserves proposal -> authority -> EffectDecision -> executor report -> observation separation under cross-platform regressions.
- Adds release-candidate metadata coherence and exact packed-artifact proof gates for Linux and Windows.
- Carries the bounded R0 proof-product telemetry and proof-first quickstart/demo preparation already integrated under the R0 DAG.

### What this is not

- Not a claim that 0.1.0-alpha.72 is fixed; alpha.72 remains the historical affected public release.
- Not an npm publication, public tag/release, or public-site change.
- Not a customer Production-readiness or GTM authorization.

## 0.1.0-alpha.72 - Public distribution candidate

### Summary

Public candidate identity for the GitHub product home and npm pack.
Carries already-authorized public-copy remediations only. Does not
reopen P8 or PI-4. Does not move npm tags. Does not claim a green
Core typecheck.

### What changed

- Contact is `support@usesteady.dev`.
- Interactive-path copy: SYSTEM WILL is shown or the request is refused.
- Telemetry sentence narrowed: the CLI may send optional product
  analytics if `POSTHOG_KEY` is set; otherwise those calls no-op.
- Public `package.json` names only files present in the product home.
- LICENSE and NOTICE are included in the pack `files` list.

### What this is not

- Not a Core type-repair release.
- Not a publication. Tags stay where they are until a later act.

## 0.1.0-alpha.71 - Public-truth / trust patch (team policy metadata + audit export)

### Summary

Patch release. Adds read-only team policy metadata display and a named audit
export command. No enforcement, signing, encryption, or authority expansion.

### What changed

- Load `<workspace>/.usesteady/policy.json` and show `policy_id`, `owner`, `version`
  in `workflow inspect` and run banner (#384 / P0-2).
- Add `usesteady audit export --run-id <id>` with `--output json` and `--output file`
  (#385 / P0-3).
- D2 boundary preserved: SessionChain-derived `tasks`/`timeline` and RunTimeline-derived
  `artifacts` remain separate top-level arrays.
- No npm publish of policy enforcement, signing, or bundle formats.

## 0.1.0-alpha.70 - USESTEADY_STORE_DIR read/write parity (P2 trust/friction patch)

### Summary

Patch release. Centralizes `USESTEADY_STORE_DIR` resolution so `run`, `history`,
`timeline`, and `doctor` read and write the same UCP store when the env var is
set. Unset-env behavior unchanged. No migration or multi-store support.

### What changed

- Honor `USESTEADY_STORE_DIR` across CLI workflow write/read paths (#380).
- Add shared `resolveStoreDir()` in `src/shell/defaults.ts`.
- Resume tokens remain workspace-local; explicit `history <store-dir>` override unchanged.
- No parser, LLM, approval, or execution expansion.

## 0.1.0-alpha.69 - CLI/Web recovery parity (P1 consistency patch)

### Summary

Patch release. Aligns CLI vague natural-language recovery with the web UI's
existing `skipped_by_intake` path. Recovery-eligible `parse_error` inputs
enter workflow intake recovery instead of hard-failing at spec load or
`--prompt` normalize. No new capability.

### What changed

- Align CLI vague NL recovery with web `skipped_by_intake` behavior.
- Allow recovery-eligible `parse_error` tasks to enter workflow recovery instead of hard-failing at load.
- Preserve safety behavior for destructive vague inputs (skipped, not executed).
- Keep R4 `ambiguous_match` hard-fail behavior unchanged.
- No parser, LLM, approval, or execution expansion.

## 0.1.0-alpha.68 - History bulk-read index drift hardening

### Summary

Patch release. Hardens bulk history reads so `usesteady history` and
`usesteady timeline --last` tolerate misindexed UCP store entries without
throwing. No new capability.

### What changed

- Fix `usesteady history` crash when workflow_run index contains misindexed envelopes.
- Fix `usesteady timeline --last` crash on stores with index drift.
- Preserve valid workflow runs while skipping invalid index entries.
- No new capability.

## 0.1.0-alpha.67 - Read-only workflow timeline

### Summary

Adds `usesteady timeline`, a read-only chronological view of one terminal
workflow run. v1.1 extends the command with an honest incomplete-run banner
when no terminal workflow record exists and with `--output json` for scripts.
Timeline remains zero-authority: no resume, no replay, no live-runs parsing,
no RunTimeline merge, and no execution changes.

### What changed

- Add `usesteady timeline --last`.
- Add `usesteady timeline --run-id <id>`.
- Add incomplete-run banner for missing terminal workflow records.
- Add `usesteady timeline --output json`.
- Keep timeline read-only: no resume, no replay, no live-runs parsing, no RunTimeline merge, no execution changes.

## 0.1.0-alpha.66 - npm README image rendering fix

### Summary

Packaging-only release. Updates the npm registry README so demo images render
on registry.npmjs.org. No runtime, CLI, workflow, doctor, or execution behavior
changes relative to `0.1.0-alpha.65`.

### What changed

- Fix npm README image rendering by replacing package-relative demo image paths with absolute raw GitHub URLs.
- No runtime, CLI, workflow, doctor, or execution behavior changes.

## 0.1.0-alpha.64 - Governed kernel widening: workflow inspect, resume tokens, bounded node -e replay

### Summary

This release widens the governed kernel layer along three independent
axes -- workflow inspect, resume tokens, and bounded `node -e` inline JS
replay -- without changing any public-wire contract. The published CLI
shape, JSON adapter schema, capability advertisement, and rejection
diagnostics are byte-identical to alpha.63 for every input the prior
release accepted. Operators upgrading from alpha.63 see new surfaces
appear; nothing previously working changes shape.

The kernel work is the headline. K6 closes the bounded-`node -e`
replayability question that K1-K5 deferred: a tightly constrained
subset of `node -e "<BODY>"` invocations are now deterministically
replayable under `usesteady replay --execute`. Everything outside that
closed structural predicate continues to refuse, with the refusal
reason refined for diagnosability. K5 echo byte-for-byte preservation
is restored after a transient byte-layer regression introduced during
K6 implementation.

### What changed (user-visible)

**1. Kernel -- K6: bounded `node -e` deterministic replay.**

A new closed structural predicate admits `node -e "<BODY>"` invocations
for replay-under-execution when `<BODY>` is one of five `console.log`
atom forms (single-quoted string, signed integer literal, boolean
literal, `null` literal; the double-quoted string form is admissible by
the inline-JS predicate but unreachable via the v1.0 wire-level quoting
of the outer command). Two-gate defense in depth: a token denylist
(`require`, `process`, `fs`, `eval`, `Date`, `Math.random`, ...) and a
syntax denylist (backticks, `${`, `//`, `/*`, optional chaining,
dynamic property access) both run before the closed allow-list. The
K6 prefix probe runs before the K5 denylist so the leading `node -e "`
shape is not collaterally refused by K5's shell-metacharacter screen.
Full design contract: `docs/KERNEL_RUN_COMMAND_K6_DESIGN.md` v1.0.

**2. Kernel -- new refusal reason `non_deterministic_inline_js`.**

`ExecutionReplayVerdict.refused.reason` and `ClassifierResult.reason`
gain the value `"non_deterministic_inline_js"`. Emitted when a command
matches the K6 `node -e "<BODY>"` prefix shape but its body fails the
inline-JS predicate (denied token, denied syntax fragment, or unmatched
allow-list atom). Out-of-scope `node` invocations that do not match
the K6 prefix shape (`node -p`, `node script.js`, etc.) continue to
refuse with the existing K5-era reason `"non_deterministic_command"`.
All `switch` sites on these discriminated unions are exhaustively
updated; TypeScript exhaustiveness guarantees no default fallthrough
hides a missing branch.

**3. Kernel -- K6 execution is host-shell-free (`shell: false`).**

K6 inline-JS replay invokes `spawnSync('node', ['-e', body], { shell:
false, cwd: <K4-sandbox>, ... })`. The `shell: false` flag is the K6
hermeticity invariant: the body string is never reparsed by an
intermediate host shell, so no platform-specific quoting, glob, or
metacharacter expansion can mutate observable behavior between
artifact capture and replay. Execution still binds to the K4 sandbox
`cwd`; no `KernelResult` widening for stdout, stderr, or exit code.

**4. Kernel -- K5 echo byte-for-byte spawn preservation restored.**

The K6 implementation transiently widened the K5 `echo` executor to
spawn the trimmed form of the command instead of the raw command
bytes from the spec. Observable behavior was identical across every
supported host shell (all strip surrounding whitespace before
parsing), but the strict byte-for-byte K5 contract from alpha.59 was
technically violated. Alpha.64 restores the original byte-preservation
behavior and pins it with a regression-guard test for whitespace-
padded `echo` invocations.

**5. New CLI surface -- `usesteady workflow inspect <spec>` (P7-min).**

A read-only structural-inspection surface for `WorkflowSpec` files.
Renders the per-task target tree and IR mapping for a spec without
executing, persisting state, or producing a `KernelArtifact`. Useful
for validating spec shape before commit, for triaging
`run <spec.json>` failures, and for review-time spec audits. The
surface is purely additive: not invoked by any existing flow, never
mutates filesystem state, and never advertises beyond its own help
text.

**6. New CLI surface -- P2-min resume tokens.**

A new resume-token builder, validator, and verifier provide
survivability for long-running workflows without hidden continuation
state. Operators can capture a workflow's mid-run state into an
explicit resume token, inspect it via `usesteady workflow
resume-info <token>`, and feed it back to resume execution. No
existing `--prompt` / `run <spec.json>` invocation changes shape; the
resume surface is opt-in and additive.

**7. Public-surface productization: survivability wedge.**

`README.md`, the marketing landing surface, and the npm description
field are aligned to the survivability + governed-replay wedge.
Em-dash and arrow glyphs replaced with ASCII per encoding governance
(no public-facing file regresses ASCII-cleanliness). Deterministic
demo recording assets shipped under `docs/demo/` and
`marketing/public/demo/`: one hero `multistep-refactor` demo plus a
four-part survivability sequence (kill-mid-run, diverged-fs,
non-idempotent, resume-info), each as `.cast`, `.svg`, `.preview.svg`,
and `.session.txt` so all rendering paths are reproducible. Public
demo links repointed to anonymous-reachable URLs (P0 marketing fix).

**8. No public-wire breaks.**

`KernelResult` shape, the `--json` op schema, `usesteady capabilities`
output (text and JSON), and rejection-message structure are
byte-identical to alpha.63 for every input the prior release
accepted. No CLI flag has been retired or renamed. No JSON adapter
field has been retired or renamed. The K6 widening expands which
commands `replay --execute` admits without changing the response
shape for either the admit path (verdict `match` / `mismatch`) or the
refuse path (verdict `refused` -- the `reason` enum now carries one
additional value `non_deterministic_inline_js`, but all prior values
remain emitted unchanged).

### Files added / changed (release-relevant)

- `src/kernel/inline-js-classifier.ts` -- NEW. Closed structural
  predicate for K6 inline-JS bodies plus the command-shape prefix
  probe and body extraction.
- `src/kernel/command-classifier.ts` -- K6 routing precedence + new
  `InScopeCommand` discriminated union for the executor.
- `src/kernel/classifier.ts` -- K6 refusal-reason precedence.
- `src/kernel/execution-replay.ts` -- K6 `node -e` execution path
  (`shell: false`) + K5 echo byte-preservation restoration.
- `src/kernel/types.ts` -- additive widening of
  `ExecutionReplayVerdict.refused.reason` and `ClassifierResult.reason`.
- `src/shell/cli/use-steady.ts` -- help-text refresh for K6 shape;
  workflow inspect + resume-info surfaces.
- `src/shell/cli/workflow-inspect*.ts`, `workflow-resume-info.ts`,
  `workflow-spec-loader.ts` -- new workflow inspect and resume-info
  surfaces (P7-min, P2-min).
- `src/workflow/resume-token-*.ts`, `resume-verifier*.ts` -- new
  resume-token builder, validator, verifier.
- `tests/kernel/inline-js-classifier.test.ts` -- NEW. 90+ unit tests.
- `tests/kernel/{classifier, command-classifier, execution-replay}.test.ts`
  -- additive K6 sections plus K5 byte-preservation regression guard.
- `tests/shell/workflow-inspect*.test.ts`,
  `tests/shell/workflow-resume-*.test.ts`,
  `tests/workflow/resume-*.test.ts` -- new workflow inspect and resume
  test suites.
- `docs/KERNEL_RUN_COMMAND_K6_DESIGN.md` -- v1.0 design contract.
- `docs/product/k6-kickoff-report-v1.md`,
  `p2-min-resume-token-design-v1.md`,
  `p7-min-workflow-inspect-design-v1.md`,
  `governed-workflow-primitives-investigation-v1.md`,
  `workflow-survivability-pressure-report-v1.md`,
  `public-launch-pack-v1.md`,
  `messaging-compression-v1.md`,
  `launch-thread-v1.md` -- design and product docs.
- `docs/demo/`, `marketing/public/demo/` -- deterministic demo
  recording assets (hero + four-part survivability).
- `README.md`, `marketing/src/pages/Landing.tsx`, `package.json`
  description -- survivability-wedge productization, ASCII encoding.

### Out of scope for alpha.64

- No K7 work.
- No timeout policy on K6 execution.
- No multi-segment shell support.
- No `stdout` / `stderr` / `exitCode` persistence in `KernelResult`.
- No public-product surface changes beyond the additive workflow
  inspect, resume-info, and demo / marketing routing.

## 0.1.0-alpha.63 - JSON adapter publication-truthfulness alignment

### Publication-truthfulness consolidation after alpha.62's #45 fix

This release consolidates the publication-truthfulness work shipped in
alpha.62. The alpha.62 fix made the executor and validator tell the truth
about which `replace` occurrence directives the runtime actually honors;
alpha.63 makes the JSON adapter's *rejection messages* and the published
`replace` *example* tell the same truth.

This release does **not** close a `usesteady-public` friction issue. No
`status/accepted` issues transition in this release. It is an internal
publication-surface alignment, framed accurately so prior friction
closures are not back-credited.

### What changed (user-visible)

**1. Missing-field diagnostic on `--json` / `batch` rejection.**

Before alpha.63, a malformed JSON op produced a generic stderr line:

    Error: unknown or invalid operation: {"type":"replace","to":"NEW","file":"x.ts"}
    See `usesteady capabilities` for the full per-op JSON schema
    ...

The operator had to consult `usesteady capabilities` to discover which
required field was missing. Alpha.63 names the specific missing
**public-wire** field inline:

    Error: unknown or invalid operation: {"type":"replace","to":"NEW","file":"x.ts"}
    op type "replace" requires field "from" but it was not provided.
    See `usesteady capabilities` for the full per-op JSON schema
    ...

The diagnostic uses the exact key the operator would type. This matters
because several public-wire field names diverge from IR-canonical names
(legacy DraftTask naming preserved per design note section 10 #7):

  - `create_dir` missing `path` -> diagnostic names `"path"`, not `"file"`.
  - `run` missing `to` -> diagnostic names `"to"`, not `"command"`.
  - `append` / `prepend` missing `to` -> diagnostic names `"to"`, not `"text"`.

The diagnostic appears only when a specific required public-wire field is
absent (or present-but-not-a-string). For content-level rejections (empty
strings after trim, invalid `occurrence` shape) and structural cases
(non-object input, missing/invalid `type`, unknown op type) the existing
generic message remains correct and is emitted unchanged.

**2. Published `replace` example carries `occurrence:"first"`.**

`usesteady capabilities` text + JSON output, the `HELP_TEXT` JSON op
schema block, and the README capabilities sample now all show:

    {"type":"replace","file":"src/Button.tsx","from":"old text","to":"new text","occurrence":"first"}

Using `"first"` makes the example a *working* invocation. The capabilities
summary continues to disclose -- byte-identical to alpha.62 -- that
`"all"` and `{ index: N }` are refused at validate stage. The example
shift does not erase that disclosure; it complements it by demonstrating
the directive that *does* round-trip.

### What did NOT change

**1. Accept/reject boundary unchanged.**

`jsonOpToIROperation` is byte-identical to alpha.62. Every JSON op that
alpha.62 accepted is still accepted byte-for-byte. Every JSON op that
alpha.62 rejected is still rejected. The new `diagnoseInvalidJsonOp`
helper is consulted only *after* `jsonOpToIROperation` has already
returned `null`, to enrich the stderr text. It does not gate anything.
The byte-for-byte parity is pinned by the legacy
`json-to-ir.identical-behavior.test.ts` suite.

**2. JSON output payload for rejections unchanged.**

`{ "success": false, "error": "invalid_op" }` is the rejection payload on
`--output json`, byte-identical to alpha.62. The diagnostic enrichment
lives on stderr only. Programmatic consumers that match on
`obj.error === "invalid_op"` continue to work without change.

**3. Unknown extra-field tolerance unchanged.**

A JSON op carrying an unrecognized key (for example,
`{"type":"create","file":"x.ts","garbageField":123}`) is still accepted
and the extra key is silently dropped, exactly as in alpha.62. Alpha.63
introduces no unknown-field rejection. Tightening that surface would be
a public-contract change and is explicitly deferred.

**4. `op-registry.ts` untouched and remains non-authoritative.**

The IR-canonical OperationRegistry has not changed. The new
`public-json-schema.ts` companion sits *beside* the registry, records
public-wire field names (which intentionally diverge from IR-canonical
names for several ops), and is **descriptive-only**:

  - Not consumed by the executor.
  - Not consumed by the validator (`feasibility-validator.ts`).
  - Not consumed by the NL parser (`nl-to-ir.ts`).
  - Not consumed by the workflow coordinator.
  - Not consumed by UCP mappers.

It is consumed solely by `json-to-ir.ts`'s diagnostic helper. The
boundary is pinned by contract tests asserting both frozenness and the
public-wire-vs-IR divergence per op.

**5. No occurrence-aware replace execution.**

Executor surfaces in `src/execution/` are untouched. Occurrence-aware
`replace` (the Option B from the #45 investigation) is not in this
release. `occurrence:"first"` flows through the executor exactly as it
did in alpha.62; `"all"` and `{ index: N }` continue to be refused at
validate stage with the alpha.62 truthfulness signaling.

### Out of scope (deliberate)

  - **No friction closure.** No `status/accepted` -> `status/shipped`
    transition. The alpha.62 #45 closure stands; alpha.63 does not
    re-credit it.
  - **No registry authority expansion.** R-alpha-full / registry-driven
    required/optional validation is explicitly deferred per the R-alpha
    investigation recommendation.
  - **No NL surface changes.** `nl-to-ir.ts` is untouched.
  - **No feasibility-validator changes.**
  - **No UCP mapper widening.**
  - **No `create.contents` exposure/removal.**
  - **No timeline / doctor / K6 / marketing-site work.**
  - **No dependency bumps.**
  - **No HELP_TEXT auto-generation.** The one-line `replace`-example
    update in HELP_TEXT was the minimal manual sync to match the
    capabilities catalog.

### Verification

  - `npm run build` clean.
  - `npm run release:gate` 148 files / 5496 passed / 4 skipped / 0 failed.
  - No dependency drift since `v0.1.0-alpha.62`.
  - Cross-surface regression: alpha.60 protected-paths (309 tests),
    alpha.60 #42 OCD warning truthfulness (38 tests), alpha.61 #49
    create_dir truthfulness (169 tests), alpha.62 #45 occurrence
    truthfulness (52 tests) all green on the alpha.63 candidate.

### Files changed since `v0.1.0-alpha.62`

  - `src/input/public-json-schema.ts` (new, descriptive companion)
  - `src/input/json-to-ir.ts` (additive: imports companion, exports
    `diagnoseInvalidJsonOp`; existing functions byte-identical)
  - `src/shell/cli/use-steady.ts` (HELP_TEXT replace example +
    rejection-path stderr enrichment in `processJsonInput`)
  - `src/shell/cli/capabilities.ts` (PUBLIC_JSON_EXAMPLES.replace adds
    `occurrence:"first"`)
  - `README.md` (capabilities sample replace example mirrors catalog)
  - `tests/input/public-json-schema.test.ts` (new contract suite)
  - `tests/input/json-to-ir.test.ts` (new diagnoseInvalidJsonOp suites,
    accept/reject parity re-pinned)
  - `tests/shell/capabilities.test.ts` (new R-alpha-min pins)
  - `tests/shell/json-input.test.ts` (new CLI-surface R-alpha-min suite)

### Issue mapping

| Item | Disposition |
|---|---|
| `usesteady-public` issues closed | none |
| Status label transitions | none |
| Indirect linkage | Consolidates alpha.62's [`usesteady-public#45`](https://github.com/shortgigs/usesteady-public/issues/45) (already `status/shipped`) by closing the *internal* publication-truthfulness gap identified in the R-alpha investigation. |

## 0.1.0-alpha.62 - replace occurrence-directive truthfulness

### Execution truthfulness: replace occurrence directives are no longer silently ignored

Addresses [shortgigs/usesteady-public#45](https://github.com/shortgigs/usesteady-public/issues/45)
(P1, `status/accepted`). Bounded fix only -- the executor still does not
honor occurrence selection; this delta makes the system tell the truth
about that.

**Pre-fix behavior (alpha.61 and earlier).** Users who specified an
occurrence directive on a replace -- "first occurrence" / "all
occurrences" / "third occurrence" via natural language, or
`{"occurrence":"all"}` / `{"occurrence":{"index":3}}` via `--json` /
`batch` -- ran into one of three misleading failure modes:

  - **NL surface, "first" + multi-match file:** generic
    `ambiguous_match` from the executor with no acknowledgment that the
    user's "first" directive was even seen.
  - **NL surface, "all" / N-th:** refused at spec-load with a diagnostic
    that pointed the user at *"the IR-shape replace op (via --json /
    batch) which carries full occurrence semantics"* -- but the JSON
    adapter silently stripped `occurrence` at parse, so following the
    pointer led to the same generic `ambiguous_match` refusal.
  - **JSON / batch surface, any `occurrence`:** silently dropped at
    parse. The `usesteady capabilities` output advertised the field as
    optional and listed `first | all | { index }` as accepted shapes,
    even though only first-match behavior reached the executor.

**Post-fix behavior.** The IR carries the user's explicit directive on
a new optional `requestedOccurrence` slot, populated only when the user
actually said so (NL surface always; JSON surface only when the public
op contained the field). The feasibility validator now refuses at
validate stage when that slot is "all" or `{ index: N }`, with a
diagnostic that quotes the directive verbatim and points at
`usesteady-public#45`. "first" still flows through to the executor
unchanged. The `--output json` payload surfaces `requested_occurrence`
on these refusals so machine consumers can see what the user asked for.

Concretely:

  - **NL surface.**
      - `... first occurrence` on a 1-match file: unchanged (executor
        succeeds).
      - `... first occurrence` on a >1-match file: unchanged (executor
        refuses with `ambiguous_match`).
      - `... all occurrences` / `... 3rd occurrence`: refused at
        spec-load. Diagnostic now reads *"replace with `all occurrences`
        is not yet supported. The executor does not honor occurrence
        selection today (the replace step picks the first match and
        refuses with `ambiguous_match` when more than one exists).
        Tracked at usesteady-public#45. Workaround: narrow `from` to a
        unique span in the file, or apply the change manually for now."*
        The misleading `--json` / `batch` pointer is gone.
  - **JSON / batch surface.**
      - No `occurrence` field: byte-identical to pre-fix (preserves
        legacy behavior for callers who don't opt in).
      - `"occurrence":"first"`: passes through to the executor; same
        result as no field on multi-match files.
      - `"occurrence":"all"` / `"occurrence":{"index":N}`: refused at
        validate stage. JSON payload:
        `{"success":false,"error":"ambiguous_match","requested_occurrence":"all"}`
        (or `"3rd"`, `"22nd"`, etc.).
      - Invalid `occurrence` shape (unknown string, non-integer index,
        zero/negative index, array, etc.): the whole op is rejected
        upstream as `invalid_op` rather than silently stripping the
        field. This closes the "advertise it, drop it" trap that the
        original friction described.
  - **`usesteady capabilities` output.** The `replace` summary now
    truthfully describes the support state:
    *"Replace `<from>` with `<to>` in `<file>`. The optional
    `occurrence` field is parsed but the executor does not yet honor
    occurrence selection (only "first" passes through; "all" and
    `{ index: N }` are refused at validate stage). Tracked at
    usesteady-public#45."*

**What this PR does not change.**

  - **Executor authority is unchanged.** The replace executor still
    picks the first match and refuses with `ambiguous_match` on >1
    matches. `requestedOccurrence` is diagnostics / preview only --
    `WorkflowTaskSpec.structuredReplace` does not gain an occurrence
    slot, and the in-process adapter does not branch on the new field.
  - **No new public `CliErrorCode`.** The validate-stage refusal reuses
    `ambiguous_match` (design note 6.5.1 rule 3 / 6.6.1 rule 7).
  - **No exit-code drift.** The refusal still exits with status 1.
  - **No new approval / refusal semantics.** "first" still reaches the
    executor; only "all" and `{ index: N }` refuse earlier than before.
  - **Public JSON schema is unchanged.** `occurrence` was already in
    `optional` for `replace`; it remains there.
  - **Out of scope:** full occurrence-aware execution (would require a
    new `WorkflowTaskSpec.structuredReplace.occurrence` slot, an
    adapter-side `n-th match` algorithm, and replay-artifact-schema
    coordination -- deferred).

**Coverage added.** NL paths verify `requestedOccurrence` is mirrored
from the parsed clause for `all` and `Nth`; JSON-to-IR pins the
absent/first/all/index parsing and the invalid-shape rejection; the
validator pins the new refusal with the ordinal-suffix wording
("1st" / "3rd" / "11th" / "22nd"); end-to-end `--output json` tests
pin the JSON payload shape with and without `requested_occurrence`
present, and verify that "first" still flows through; the op-registry
test pins the truthful summary and explicitly forbids the old
`first | all | { index }` phrasing.

## 0.1.0-alpha.61 - create_dir execution-truthfulness alignment

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

Post-alpha.60 delta. Closes 1 accepted friction across 1 trust surface:
execution truthfulness (#49). No new public `CliErrorCode`, no new
approval semantics, no new operation type, no exit-code change.

Included PR: [#322](https://github.com/shortgigs/usesteady-core/pull/322).
No other deltas since alpha.60 (`a6c1264`) other than the release-
process documentation merged via [#321](https://github.com/shortgigs/usesteady-core/pull/321)
(`docs/RELEASE.md` -- process hygiene, no product surface impact).

This is also the first release under the
[`docs/RELEASE.md`](./docs/RELEASE.md) runbook merged after the
alpha.41-alpha.60 release-hygiene postmortem. The V1-V5 post-publish
verification block in the release PR exists to prove
publish-success-implies-release-success, addressing the silent
alpha-dist-tag and git-tag drift identified in that postmortem.

### Execution truthfulness: `create_dir` aligns with `create` on `target_exists`

Closes [shortgigs/usesteady-public#49](https://github.com/shortgigs/usesteady-public/issues/49)
(P2, `status/accepted` since alpha.58).

**Pre-fix behavior (alpha.59 and earlier).** `create_dir` against an
existing directory was not refused at the feasibility validator, and the
in-process adapter called `mkdirSync(..., { recursive: true })`, which
silently succeeds on `EEXIST`. The run then reported
`{"success":true,"error":null,...}` on `--output json` (and "Completed
successfully" on the text path) for a no-op. Files inside the existing
directory were untouched -- there was no destructive side effect -- but
the success banner lied about what happened, breaking the
execution-truthfulness contract that `create` (write_file) has held since
M3.

**Post-fix behavior.** Both the feasibility validator (primary
enforcement) and the in-process adapter (defense-in-depth, mirroring the
S2/#36 and Cluster B Iter 4 / #60-#67 posture) refuse `create_dir`
against an existing path with the existing public `target_exists`
`CliErrorCode` -- the same code `create` (write_file) already used for
the analogous shape. `--output json` now emits
`{"success":false,"error":"target_exists",...}` and the text path
prints "Refusing to create directory: target already exists at <abs>"
before the executor is reached.

**Scope discipline (mirrors PR review-posture).**

- No new public `CliErrorCode`: `target_exists` already covered `create`
  and `rename`; this fix extends it to `create_dir` without inventing
  new vocabulary.
- No new approval-bypass affordance, no new exit code, no execution-
  summary widening, no new operation type.
- No new symlink check on `create_dir` (would be a new refusal class).
  `existsSync` follows symlinks, so a symlink that resolves to an
  existing path is caught via the same code path; a symlink to a
  non-existent target still passes this check (pre-existing behavior,
  unchanged).
- Nested-directory behavior preserved: only the leaf is probed. For a
  new leaf whose parents do not yet exist, the executor's
  `mkdirSync(..., { recursive: true })` still creates parents in one
  shot. Only the case where the leaf path itself already exists is
  refused.
- No work on [#45](https://github.com/shortgigs/usesteady-public/issues/45)
  (occurrence-directive divergence on replace ops, P1) -- that is a
  separate PR with a different shape.

**Tests.** Validator-stage refusal of `create_dir` on existing empty
directory, existing populated directory (with files preserved), happy
path of fresh leaf, happy path of fresh nested leaf, happy path of
fresh leaf with existing parents; ordering against `prohibited_path`
and `invalid_filename_chars` (more-specific refusals still win);
public-code parity with `create`. Adapter-stage defense-in-depth
covering all of the above plus the file-at-target case (existing file
occupies the target path -- no clobber, refused with `target_exists`).
End-to-end CLI test on `--json --output json` confirms exit code 1,
`success:false`, `error:"target_exists"`, and that files inside the
pre-existing directory are preserved verbatim.

**Truthfulness invariant added by this fix.** For every path-bearing
creation op (`create`, `create_dir`, `rename`'s `newPath`), a
public-surface success result now implies the executor performed the
creation. Previously this held for `create` and `rename` but failed
silently for `create_dir`.

## 0.1.0-alpha.60 - Protected paths + filename hygiene + OCD warning truthfulness

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

Post-alpha.59 delta. Closes 4 accepted frictions across 2 trust surfaces:
filesystem location safety (Cluster B Iter 4: #60, #67, #68) and
execution truthfulness (#42). One new public `CliErrorCode`
(`prohibited_path`); no new approval semantics, no new operation types,
no exit-code change, OCD remains non-blocking.

Included PRs: #318 (Cluster B Iter 4) and #319 (#42 OCD warning
alignment). No other deltas since alpha.59 (`4cbac6c`).

### Cluster B Iteration 4 - Protected Paths Registry + whitespace-bounded filenames

Design rationale: [`docs/adr/ADR-cluster-b-iteration-4-protected-paths.md`](./docs/adr/ADR-cluster-b-iteration-4-protected-paths.md).

Closes three accepted frictions in one coherent feature, following
the flat pure-function style of Iter 2 / Iter 3 / Iter 3.5 / Iter 3.6.

- **shortgigs/usesteady-public#60** (`create_dir` into `.git/hooks`):
  refused at the validate stage with the new public `prohibited_path`
  code; defense-in-depth re-check at the cursor adapter mirrors the
  S2/#36 posture (every fs-op site).
- **shortgigs/usesteady-public#67** (silent `delete` of `.git/HEAD`):
  same refusal class, applied symmetrically to delete / rename
  (both from and to) / append / prepend / replace. Unlike filename-
  hygiene checks (Iter 2/3), the protected-path check runs on
  `delete` -- the friction shape is symmetric.
- **shortgigs/usesteady-public#68** (leading/trailing whitespace in
  filenames): refused at validate/executor; folds under the existing
  `invalid_filename_chars` public code (internal discriminant
  `invalid_filename_whitespace`). Per-segment check catches
  intermediate-directory whitespace too, not just basenames.

#### Authority surface

- One new public `CliErrorCode`: `prohibited_path`. Strongly justified
  (distinct semantic from `invalid_filename_chars`: path is well-
  formed and inside the workspace; the LOCATION is off-limits;
  remediation is "use git directly," not "rename").
- No new operation types, no new approval semantics, no new
  approval-bypass affordances.
- V1 protected set: any segment exactly equal to `.git` (case-
  insensitive). Regular workspace files like `.gitignore`,
  `.gitattributes`, and `.gitkeep` are NOT protected.

#### Invariants preserved

- All Iter 1-3.6 invariants hold (1097 passing tests across
  `tests/input`, `tests/safety`, `tests/cursor`).
- Ordering: codepoint check -> reserved-name check -> whitespace
  check -> canonicalization check -> protected-path check, so the
  most actionable diagnostic wins (e.g. `"CON "` surfaces as
  reserved-name with rename suggestion, not as whitespace).
- Pure functions, no fs / time / global state. Same input, same
  output on every host.

#### Out of scope

- Other VCS internals (`.svn/`, `.hg/`), secrets directories
  (`.env*`), `node_modules/`. No friction signal yet -- extension
  requires a real reporter case (AGENTS.md "no new authority without
  a current user flow").
- Protected-path receive-side defense-in-depth at the replace gate.
  The validator catches it pre-receive; the adapter's `receive()`
  path defers to that (consistent with how filename-safety is wired).

#### Friction -> fix mapping

| Friction (usesteady-public)                  | Fix surface                                       |
|----------------------------------------------|---------------------------------------------------|
| #60  - create_dir into .git/hooks            | `validateProtectedPath` + per-op wiring           |
| #67  - silent delete of .git/HEAD            | `validateProtectedPath` covers delete (new scope) |
| #68  - leading/trailing whitespace in name   | `validateFilenameSafety` whitespace extension     |

### Issue #42 - OCD warning vs success reporting alignment

Closes shortgigs/usesteady-public#42. The OCD evaluator already
surfaces the conflict frame as `WARNING - OCD conflict detected
(non-blocking)` with "System will execute on approval." text (S4
fix, alpha.5x). The remaining trust gap was the END-OF-RUN summary:
a run that printed a WARNING frame and then executed under `--yes`
announced "Completed successfully" with no acknowledgement that a
warning had been accepted.

#### Change

- `WorkflowTask` gains an optional `conflictsAccepted?: number`
  counter, incremented inside `acceptWorkflowConflict` whenever the
  user (or `--yes`) accepts an OCD conflict warning for that task.
- `ExecutionSummary` gains a required `warnings_accepted: number`
  field, summed only across tasks that actually ran (`outcome ===
  "accepted"`).
- `renderExecutionSummaryLines` reports `! Completed with N
  warning(s) accepted` instead of `Completed successfully` when
  `summary.success && summary.warnings_accepted > 0`. Plural/singular
  agreement preserved. Failure / neutral forms unchanged.
- `--output json` surface gains `warnings_accepted: <number>` so
  machine consumers (CI scripts, agent integrations) can surface the
  same trust signal the human banner now shows. Strictly additive --
  pre-#42 consumers reading `success` / `error` / `failed_at_step` /
  `executed_steps` / `total_steps` are unaffected. The field is
  always emitted on post-#42 runs (zero when no warning was
  accepted); pre-#42 result-file fixtures are tolerated via guarded
  projection (field omitted when the upstream result does not carry
  it -- no invented data).

#### Invariants preserved

- OCD evaluator behavior unchanged (still non-blocking).
- Conflict-frame text unchanged.
- Exit code unchanged (0 on success, warnings or not).
- JSON `success` key unchanged (the run still succeeded).
- Public CliErrorCode surface unchanged.
- Pre-#42 runs with zero warnings still see the verbatim
  `Completed successfully` banner (regression-guarded).
- Pre-#42 result-file fixtures (without `warnings_accepted`) still
  produce a valid `--output json` payload -- the field is simply
  absent rather than invented.

## 0.1.0-alpha.59 - Bundled stabilization (E2E baseline, Cluster B Iter 2+3+3.5+3.6, K2 cleanup, K5 run_command replay, CLI well-formedness guardrail)

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

**Bundled-stabilization release. Multiple stabilized sprint surfaces
converge into a single trustworthy alpha. No new authority. No new
operation types. No new approval semantics. No generalized shell
execution. No autonomous execution. No semantic replay. No AI
runtime orchestration.**

This release is the result of seven sprint surfaces that were
implemented, regression-tested, and operationally observed prior
to packaging. Each surface stayed inside an existing authority
boundary; this release commit assembles them.

### What shipped

#### E2E baseline + UI-W1 invariant restoration (Sprint 1)

The alpha.53-alpha.58 intake + UI drift left the Playwright E2E
suite at 20 / 27 red. One failure was a real product regression:
`server.ts /api/workflow/start` did not run NL synthesis on
web-UI tasks, so tasks the CLI would have classified as
`skipped_by_intake` were emitted as `task_failed` from the web
UI. The UI-W1 invariant (intake refusal is the same outcome on
every entrypoint) was broken silently.

- `server.ts`: `synthesizeStructuredFieldsFromNL` is now called
  idempotently per task.
- `src/workflow/coordinator.ts`: routes `!isDeterministicTaskSpec`
  to `skipped_by_intake`.
- E2E selectors updated to current alpha.55-alpha.58 UI labels.

#### Cluster B Iteration 2 wiring + Iteration 3 OS-reserved names + Iteration 3.6 message polish (Sprints 2 + 4)

Cluster B continues to harden the filesystem layer. Three
sub-classes of the same friction (filename that looks valid in
the developer's editor but breaks elsewhere) are now refused at
the safety adjacency, before preview / before approval:

1. **Invisible / canonical-divergence filenames** (`#50`, `#51`,
   from a prior public reproducer) -- already partially handled
   in alpha.52; this release ships the unified adjacency.
2. **BIDI / zero-width / control codepoints in `replace.newValue`**
   (`#52`) -- new refusal at the executor with the new error
   code `invalid_replacement_chars`.
3. **OS-reserved device names on Windows** (CON, NUL, AUX,
   COM1-9, LPT1-9) -- new refusal with the new error code
   `invalid_filename_reserved_name`. Cross-platform: a Linux
   developer creating `CON.tsx` no longer corrupts a Windows
   teammate's clone on pull.

Implementation:
- New flat-adjacency module `src/safety/filename-safety.ts`
  exporting `validateFilenameSafety`,
  `validateReplacementTextSafety`, and the canonical-divergence
  classifier. No new policy class. No new abstraction layer.
- Wired at three call sites: `FeasibilityValidator`,
  `CursorInProcessAdapter.executeFsOp`, and the
  `CursorInProcessAdapter` replacement-text gate.
- Two new `CliErrorCode` discriminants:
  `invalid_replacement_chars`, `invalid_filename_reserved_name`.
- One new `CursorExecutionErrorCode` discriminant:
  `invalid_replacement_chars` (matching `formatErrorHeadline`
  case added so the exhaustive switch stays exhaustive --
  this was a Sprint 2 type-union gap caught and closed during
  alpha.59 `tsc -p tsconfig.build.json`).
- Bug fix: the adapter and validator were previously collapsing
  all specific codes to `invalid_filename_chars`. Specific
  codes now propagate so reserved-name refusals are visible.

Message polish (Iter 3.6):
- `NAMED_CODEPOINTS`, `formatCodepoint`, `buildOffenderDetail`,
  `describeClasses`, `suggestReservedNameRename` added to
  `filename-safety.ts`. No new `CliErrorCode` from polish.
- Reserved-name suggestion preserves file extensions
  (bug caught and fixed by test in this release).
- Per-discriminant summary phrases in `feasibility-validator.ts`
  sharpened.

#### Cluster B Iteration 3.5 NL delete safety gate + Iter 3.6 vague-delete message polish (Sprints 3 + 4)

Sprint 1's E2E baseline pass surfaced a real safety regression:
NL synthesis was converting vague delete targets ("delete
everything", "remove all") into concrete `delete_file`
operations. The IR layer accepted the synthesized op; only
approval-stage vigilance stood between intent and execution.

This release refuses vague delete targets at the NL parse stage
so they never become concrete `delete_file` operations:

- `VAGUE_DELETE_TARGETS` set + `isVagueDeleteTarget` guard
  added to `src/input/nl-to-ir.ts`.
- `matchDelete` returns `parse_error` for vague targets, which
  routes through `skipped_by_intake` ("Could not understand").
- Polished `parse_error` message wording.

No new `CliErrorCode`. The refusal surfaces through the
existing intake-failure path -- vague intent is an intake
failure, not a safety detector hit.

#### K2 parse_error precedence cleanup + structuredReplace drift guard + K5 design lock (Sprint 6)

Three kernel maintenance items from the Sprint 5 read-only
Kernel Audit:

- **K2 parse_error precedence**: extracted private
  `synthesizeRawErrorCode` helper. New invariant **INV-K2-PE-1**
  documents the three origins of `parse_error` and the
  precedence rule. Subtle empty-string-falsy regression
  caught and fixed. Behavior preserved byte-for-byte against
  the prior K2 test suite.
- **structuredReplace drift guard**: new
  `tests/kernel/structuredReplace-drift.test.ts` -- 13 fixtures
  across `accepted`, `file_not_found`, `old_value_not_found`,
  `ambiguous_match`. Asserts byte-identical normalized
  outcomes between the K4 inline path and the production
  adapter path. Self-verified by injected-bug exercise.
  `executeStructuredReplace` and `TaskReplayOutcome` exposed as
  `@internal` test seams only.
- **K5 design doc** locked at v1.0 (drafted v0.1 here, the
  v1.0 update lands in the Sprint 7 commit). Eight new
  invariants **K5-I11..I18**. Section 11 open questions
  resolved: `node -e` deferred to K6, K2 parse_error split
  deferred to a parallel PR, `mkdir -p` / `rm -rf` dropped
  from the allow-list as redundant with existing operation
  types, `true` / `false` short-circuit in pure Node.

#### K5 run_command deterministic replay (Sprint 7)

The Kernel Audit's #1 priority surface. Adds deterministic
replay support for a strictly-bounded `run_command` allow-list.
**The allow-list is `echo <args>`, `true`, `false` and nothing
else.** No shell escape. No environment widening. No new
authority. No new approval semantics. Operator approval is still
required for every `run_command` op.

- New `src/kernel/command-classifier.ts` -- two-gate
  `isReplayableCommandShape`: denylist first
  (defense-in-depth), then allow-list regex. Classifier never
  executes; only classifies.
- `src/kernel/types.ts` widened additively only:
  `ClassifierResult.reason?` and
  `ExecutionReplayVerdict.refused.reason` become
  discriminated unions. Existing consumers unchanged.
- `src/kernel/classifier.ts` consults the classifier for
  `run_command`. `classifyForReplay` emits the K5 `reason`
  discriminant so downstream surfaces can name the precise
  refusal class.
- `src/kernel/execution-replay.ts` adds `executeRunCommand`:
  `echo` via `spawnSync(shell: true)` inside the sandbox;
  `true` / `false` short-circuit in pure Node (no spawn).
- HELP_TEXT in `src/shell/cli/use-steady.ts` documents the
  K5 allow-list.

#### CLI entrypoint well-formedness guardrail (Sprint 8)

Converts Sprint 7's HELP_TEXT lesson into a cheap pre-merge
guardrail. An early Sprint 7 HELP_TEXT edit used backticks
INSIDE the existing HELP_TEXT template literal, breaking
esbuild transform for the entire CLI. The kernel-suite did not
catch this -- it was only visible to full-vitest, via 36
downstream CLI-subprocess test failures with confusing surface
symptoms.

- New `tests/shell/cli-entrypoint-wellformed.test.ts` -- one
  test, ~200 ms, spawns `usesteady --help` and asserts exit 0
  + non-empty stdout. Inlines the esbuild error
  (`file:line:col`) into the failure message so a future
  reader sees the bug on the first failed assertion.
- No new dependencies. No runtime change.

### What remains intentionally refused

These surfaces were considered and deliberately left out of
alpha.59. Each has an explicit reason in scope discipline.

- **`run_command` outside `echo` / `true` / `false`** -- shells
  out beyond the K5 allow-list. K6 territory; not authorized.
- **`node -e` arbitrary script execution** -- K6 territory;
  deferred (alpha.59 is not a generalized-shell-execution
  release).
- **`mkdir -p` / `rm -rf` as `run_command` shapes** -- redundant
  with `operationType: "create_dir"` / `"delete_file"`, and
  `cmd.exe` semantics for `mkdir -p` differ from POSIX. Adding
  them would widen the allow-list without operator benefit.
- **K2 `parse_error` discriminant split** -- a separate parallel
  PR after alpha.59 review. Not a regression; the existing
  ladder is documented (INV-K2-PE-1) and preserved.
- **Execution timeline implementation** -- PR #315 is design-only
  and remains design-only. No runtime in alpha.59.
- **Workflow doctor surface** -- not in scope. No design lock.
- **Reactive fix for public#50 U+202E bare-create coverage gap**
  -- classified as uncovered Cluster B sub-class; explicitly
  not addressed in alpha.59. Future work must be separately
  scoped, bounded, reviewed, released.
- **Clarifying fix for public#51 NFD/NFC behavior** -- the
  `ambiguous_match` refusal is the intended fail-closed
  canonicalization gate; no runtime change. A wording
  clarification may follow in a future cycle if operator
  misreading repeats.
- **AI command generation / autonomous execution** -- not in
  scope. Out of every track UseSteady is building.

### Preserved invariants

- **Replay hermeticity**: identical inputs yield identical
  replay bytes. K5 widens the replayable shape set; it does
  not weaken determinism.
- **Approval-before-execution**: every `run_command`, every
  `replace`, every fs op still requires operator approval at
  the SYSTEM WILL surface. K5 changes WHICH commands can be
  classified, not WHEN approval is required.
- **Safety-gate runs before approval**: the credential /
  secret detector, the canonicalization gate, the filename
  adjacency, and the new vague-delete intake refusal all
  fire pre-preview.
- **UI-W1 entrypoint parity**: CLI `--prompt`, `run <spec.json>`,
  `--json`, `batch <file>`, and web UI all route intake
  refusal to `skipped_by_intake`. No entrypoint silently
  promotes to `task_failed`.
- **Additive widening only**: `ClassifierResult` and
  `ExecutionReplayVerdict` unions widened; no breaking
  removal. Existing consumers unchanged.
- **One-source-of-truth**: every operation type in every
  template still maps to `ALL_OPERATION_TYPES`. HELP_TEXT
  still documents every public op. The IR-shape-validity test
  still passes against every template.

### Stabilization hardening added

- **TS2322 closure** in `CursorExecutionErrorCode` -- the
  Sprint 2 type-union gap is closed. `npm run build` is clean.
- **structuredReplace drift guard** -- behavioral divergence
  between the K4 inline path and the production adapter path
  is now a localised assertion failure with a precise hint,
  not a downstream mystery.
- **K2 parse_error precedence is documented and tested** --
  INV-K2-PE-1 names the three origins and the precedence
  ladder. Future edits to error-codes.ts can be reviewed
  against the invariant.
- **CLI entrypoint smoke test** -- `usesteady --help` cannot
  silently fail to load. A future HELP_TEXT edit that breaks
  esbuild transform will be caught in ~200 ms, not via 36
  downstream test failures.
- **Specific filename-safety error codes propagate** -- the
  adapter and validator no longer collapse all sub-classes
  to `invalid_filename_chars`. Operators see the exact
  refusal class.

### Known intentionally-deferred scope

- K6 `node -e` replayability (separate authorization required).
- K2 `parse_error` discriminant split (separate PR after
  alpha.59 review).
- Public#50 U+202E bare-`create` coverage gap (uncovered
  Cluster B sub-class; not a regression).
- Execution timeline implementation (PR #315 stays
  design-only).
- Cross-platform CI runners.
- Workflow doctor surface.
- New ergonomics capability candidates.

### Friction -> fix -> guardrail

| Friction class | Refused as / fixed where | Guardrail |
|---|---|---|
| `public#50` -- path-traversal canonical divergence | `validateFilenameSafety` + path adjacency at validator + executor + replace-match gate | filename-safety.test.ts (Iter 2 cases) |
| `public#52` -- BIDI / zero-width / control in `replace.newValue` | Executor refuses with `invalid_replacement_chars` before write | canonicalize-adjacent-surfaces.test.ts + filename-safety.test.ts |
| OS-reserved names on Windows (`CON.tsx`, `COM1.ts`, etc.) | Validator + executor refuse with `invalid_filename_reserved_name` cross-platform | feasibility-validator.invalid-filename-chars.test.ts |
| Vague NL delete intent ("delete everything") | `nl-to-ir.matchDelete` returns `parse_error` -> `skipped_by_intake` | +37 tests in nl-to-ir.test.ts |
| UI-W1 intake parity broken on web UI | `server.ts` runs NL synthesis; coordinator routes non-deterministic specs to `skipped_by_intake` | E2E specs assert parity |
| K4 inline vs production-adapter `replace` divergence (would be silent) | Drift matrix in structuredReplace-drift.test.ts | 13 deterministic fixtures across 4 outcome classes |
| K2 `parse_error` precedence ambiguous in source | Helper extracted; INV-K2-PE-1 documents the ladder | K2 suite preserved byte-for-byte; new invariant in source |
| HELP_TEXT esbuild break (Sprint 7 incident) | One ~200 ms test asserts `usesteady --help` loads | cli-entrypoint-wellformed.test.ts |

### Verification

- `npm run build`: clean.
- `npm run release:gate`: green -- **142 test files, 5256
  passed, 4 skipped, 0 failed**.
- Kernel suite: 301 / 301 green.
- Playwright E2E suite green against this delta.
- No dependency drift.
- Changelog reflects only the committed delta in this PR.

### Versioning posture

This is `0.1.0-alpha.59`. Alpha only. Not beta. Not
"production-ready." The replay scope is widened to three
allow-list commands (`echo`, `true`, `false`); it is not
generalized shell execution.

`npm publish` is **not** authorized by this PR. Publish
happens after explicit approval following merge.

## 0.1.0-alpha.58 - Domain-specific recipe templates

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

**Ergonomics continuation release. Capability-track section 3.2
extension. No new template engine, no parameter DSL, no dynamic
generation, no new operation types, no runtime semantic changes,
no dependency additions.**

### What this release fixes

The alpha.57 walkthrough confirmed users could now reliably pick
the right command for the right JSON shape (`--json` / `batch` /
`run`). The next-highest authoring friction was "how do I safely
do X?" -- a first-time operator who knew the invocation surface
still had no concrete worked example for common dev tasks
(version bump, adding an import, updating a dotenv key).

The alpha.54 starter templates covered append, rename,
multi-file-replace, create-dir-then-rename, and create-then-append,
but did not cover three high-volume real-world patterns:

- **F-A57-AUTH-1** -- no template demonstrated a coordinated
  cross-file edit (e.g. version bump in package.json + matching
  CHANGELOG entry). Operators authored these by hand, repeatedly,
  with no canonical safe example to copy.
- **F-A57-AUTH-2** -- no template demonstrated `prepend`. The
  operation type was reachable via `usesteady capabilities` but
  had no worked example, so first-time operators defaulted to
  `append` for "add an import" tasks where `prepend` is actually
  correct -- producing imports at the end of files.
- **F-A57-AUTH-3** -- no template demonstrated a `replace` against
  a non-JSON line-based format (dotenv, ini-style). Operators had
  to infer that exact-line `replace` works for `KEY=value` lines,
  including the runtime difference that `replace` refuses
  `file_not_found` on missing files (unlike append/prepend, which
  create them).

### What ships

#### Three new recipe templates

All three reuse the existing `TEMPLATE_REGISTRY` shape verbatim.
No template engine, no parameter DSL, no dynamic generation. Each
is a static JSON asset like the alpha.54 starter templates.

- **`bump-version`** -- `replace` `"version"` in package.json +
  `append` matching CHANGELOG.md entry (2 ops across 2 files).
  Demonstrates coordinated cross-file edits. Safety notes are
  explicit that the recipe does NOT run `git`, `git tag`, `npm
  version`, `npm publish`, or any command, and does NOT update
  lock files. Names all three `replace` failure classes
  (`file_not_found`, `old_value_not_found`, `ambiguous_match`).
  Documents the prepend-instead-of-append alternative for
  newest-at-top CHANGELOGs.

- **`add-import`** -- `prepend` an import statement to the top of
  a source file (1 op). First template to demonstrate `prepend`.
  Safety notes are explicit that prepend lands BEFORE any license
  header, shebang, or `"use strict";`, and that the recipe does
  NOT sort, group, or de-duplicate imports. Tells the operator
  to terminate the imported line with `\n` so it lands on its own
  line.

- **`safe-env-update`** -- `replace` one `KEY=value` line in a
  dotenv-style file (1 op). First template to target a non-JSON
  line-based format. Safety notes are explicit that `replace`
  refuses `file_not_found` on missing files (does NOT auto-create
  unlike append/prepend), that quoting/whitespace/inline comments
  change the match, that dotenv files often hold secrets (use the
  SYSTEM WILL preview), and that gitignored .env files should be
  paired with a tracked `.env.example`.

Every safety note is verified against runtime behavior in
`src/cursor/adapters/inprocess-adapter.ts`. The test suite
asserts the exact runtime-class strings appear in the relevant
notes so a future edit cannot regress wording silently.

### Hard constraints honored

- No new template engine, parameter DSL, or dynamic generation
- No new operation types (every op uses `replace`, `append`, or
  `prepend` -- all already in `ALL_OPERATION_TYPES`)
- No recipe-specific authority or runtime semantic changes
- No semantic-review layer
- No autonomous workflow generation
- No parser expansion
- No dependency additions
- No multi-surface capability wave (templates surface only)
- No hidden execution semantics
- Runtime-truthful wording (every safety claim asserted against
  runtime behavior in tests)
- Byte-deterministic output (existing template determinism
  contract extended to the three new entries)

### Test coverage

17 new tests in `tests/shell/templates.test.ts`:

- **T10b**: the 3 alpha.58 recipes are present in `TEMPLATE_NAMES`
- **IR-shape-validity**: every operation in every template parses
  cleanly through `jsonOpToIROperation` -- locks down the wire-
  shape contract so a future template addition cannot ship a shape
  that the `--json` / `batch` adapter rejects
- Per-recipe content + safety-note vs runtime alignment for each
  of `bump-version`, `add-import`, `safe-env-update`

Full suite: **4889 passed** (was 4870; +19), 4 pre-existing skips.
137 test files. `npm run release:gate` -- PASS.

### Friction-to-usability mapping

| Friction (alpha.57 walkthrough) | Recipe (alpha.58) |
| --- | --- |
| F-A57-AUTH-1 (no cross-file safe example) | `bump-version` |
| F-A57-AUTH-2 (no `prepend` worked example) | `add-import` |
| F-A57-AUTH-3 (no dotenv replace example) | `safe-env-update` |

---

## 0.1.0-alpha.57 - Workflow invocation shape ergonomics

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

**Ergonomics/clarity release. No new capability surface beyond the
read-only `examples` catalog. No execution-model, planner, approval-
model, schema, operation-set, or dependency changes.**

### What this release fixes

The alpha.56 walkthrough surfaced the highest-leverage onboarding
friction: operational confusion across the four workflow-invocation
surfaces.

- **F-A56-OPS-1** -- a first-time operator could not predict which
  command (`--json`, `batch <file>`, `run <file>`) accepted which
  JSON envelope shape (single op vs. op array vs. WorkflowSpec).
  Help text covered each individually; no single surface explained
  the mapping shape -> command.
- **F-A56-OPS-2** -- shape-mismatch error messages named only the
  generic contract ("not valid JSON", "unknown or invalid
  operation", "Workflow spec was not recognized"). They did not
  point the operator at the matching command form OR at a copyable
  example. Recovery required reading the help text and guessing.
- **F-A56-OPS-3** -- documenting "use this command for this shape"
  required reading three separate help-text blocks and inferring
  the mapping. There was no canonical reference for the mapping.

### What ships

#### `usesteady examples` (new read-only subcommand)

Pure module `src/shell/cli/examples.ts`. Renders the three accepted
invocation shapes with their command form, when-to-use guidance,
and a minimal copyable JSON example each:

| id | command | shape |
| --- | --- | --- |
| `json` | `usesteady --json '<inline op>' --yes` | single JSON op object |
| `batch` | `usesteady batch <file> --yes` | JSON array of op objects |
| `run` | `usesteady run <file>` | WorkflowSpec object (also auto-wraps single op + array) |

Each pattern carries an identical canonical content shape (append-
to-`NOTES.md`) so the operator sees the same body in every form,
making the "what changed across shapes" question trivially
inspectable. Quick rule-of-thumb block reinforces shape -> command.
Sibling cross-references to `quickstart` / `capabilities` /
`templates` / `help` so the operator can navigate from one place.

Authority pattern matches `capabilities` / `quickstart` /
`templates`:

- in `PURE_SUBCOMMANDS` (never reads stdin, never executes);
- exempt from the `--output json` requires `--yes` rule (catalog
  is informational, no execution to gate);
- deterministic byte-identical output across runs for a given
  build;
- single-line stable-key JSON shape;
- never imports the planner, safety gate, executor, or approval
  surface.

#### Shape-aware error guidance (three surfaces)

| Surface | Pre-alpha.57 first line (unchanged) | Alpha.57 addition |
| --- | --- | --- |
| `--json <bad>` invalid JSON | `Error: input is not valid JSON` | Names the `--json` contract ("single inline JSON op object (or an array)"); pointer to `usesteady examples`. |
| `batch <bad-json>` invalid JSON | same first line | Names the `batch` contract ("JSON array of op objects"); pointer to `usesteady examples`. |
| `--json` / `batch` invalid op | `Error: unknown or invalid operation: <op>` | Pointers to `usesteady capabilities` (per-op schema) and `usesteady examples`. |
| `run <file>` shape mismatch (`RUN_SPEC_ACCEPTED_SHAPES_MESSAGE`) | `Workflow spec was not recognized. Accepted shapes: ...` | New `Command form per shape:` block mapping each shape to its matching command; pointers to `usesteady examples`, `usesteady capabilities`, `usesteady --help`. |

Error classes (`invalid_json`, `invalid_op`), exit codes (2 / 1),
and the `--output json` machine-readable body are byte-identical.
Only human prose extended.

#### Pre-existing contract preserved

The `Accepted shapes` / `WorkflowSpec` / `JSON op` tokens that the
governance and shell shape-error regex suites assert against are
preserved verbatim:

- `tests/governance/input-surface-integrity.test.ts`
- `tests/shell/shell-workflow-spec.test.ts`

No machine consumer of these messages breaks.

#### README minimal addition

One new "Workflow Shapes" section between "Discover what UseSteady
can do" and "Core idea". Three-row table mapping shape -> command
-> when-to-use, plus the `usesteady examples` pointer. No other
README changes.

#### Help text

`HELP_TEXT` advertises `usesteady examples` and `usesteady examples
--output json` alongside the existing pure-subcommand block.

### Friction -> Fix mapping (alpha.56-walkthrough-grounded)

| Friction observed | Fix in alpha.57 |
| --- | --- |
| Operator could not predict command-per-shape | `usesteady examples` catalog with explicit mapping |
| `--json` invalid JSON did not name the expected shape | Surface-aware addendum ("single inline JSON op object") + pointer |
| `batch` invalid JSON did not name the expected shape | Surface-aware addendum ("JSON array of op objects") + pointer |
| `--json` / `batch` invalid op forced help-text guessing | Pointer to `usesteady capabilities` for the per-op schema |
| `run <file>` shape mismatch did not name the matching command | `Command form per shape:` block + pointer to `usesteady examples` |
| Three help-text blocks required to derive shape -> command mapping | README "Workflow Shapes" table + canonical `examples` catalog |

### Authority story

Pure module. Reuses `capabilities` / `quickstart` / `templates`
infrastructure (PURE_SUBCOMMANDS gate, `--yes` exemption,
deterministic-output contract). The new error-message hints are
strings only -- no new error classes, no new exit codes, no parser
changes, no envelope coercion. `loadWorkflowSpecFromFile` auto-wrap
behavior is byte-identical. The catalog reuses the same op-shape
conventions `jsonOpToIROperation` already accepts so no second
source of truth is introduced.

### What does NOT change

- Execution engine: byte-identical to alpha.56.
- Planner: byte-identical.
- Approval model: byte-identical.
- Operation set: same 8 operation types.
- Parser: byte-identical -- no hidden coercion between formats,
  no automatic envelope conversion, no AI generation.
- Dependencies: zero additions.
- Spec hash semantics, replay, audit envelope: byte-identical.
- Pre-alpha.57 valid `--json '<op>' --yes` and `run <WorkflowSpec
  -file>` calls behave byte-identically.

### Tests

`tests/shell/examples.test.ts` -- 26 new tests:

- Pure formatter unit tests: catalog order (json, batch, run),
  command form per id, minimal-example JSON round-trip, frozen
  catalog, determinism (I1, I6, I7).
- JSON render: single-line + trailing newline, valid JSON shape,
  byte-determinism (I2).
- Text render: byte-determinism, sibling cross-references
  (quickstart / capabilities / templates / help), explicit
  read-only language (I3, I8).
- CLI integration: no `--yes` needed, `--output json` exempt from
  `--yes`, `--help` form, global `HELP_TEXT` advertises the
  subcommand, deterministic across invocations (I4, I5).
- Invocation-shape error guidance: `--json <bad>`, `batch <bad>`,
  `--json <unknown op>`, `run <bad-spec>` -- each error keeps its
  canonical first line AND adds the matching command-form hint
  AND the pointer to `usesteady examples` (I9).
- Backward compatibility: a valid `--json` op and a valid `run
  <WorkflowSpec>` do NOT regress to exit code 2.

Existing governance + shell shape-error suites pass unchanged.

Full suite: 4870 passed (was 4844; +26 from this suite), 4
pre-existing skips. No regressions in `governance`, `shell`,
`capabilities`, `templates`, `quickstart`, `phase-11d`,
`workflow-coordinator`, `shell-workflow-render`,
`system-will-preview`, or `adjacent-surface-consistency` suites.

### Release engineering

- `npm run release:gate` continues to use `test:release` with
  `--retry=2` for pre-existing test-order-dependent shell-spawn
  flakes documented in alpha.52 release engineering notes.
- `check-stdin-ownership` continues to scan git-tracked files
  only.

Implementation PR:

- `shortgigs/usesteady-core#311` -- workflow invocation shapes
  (`examples` + shape-aware error guidance).

### Posture after alpha.57

This is an **ergonomics stabilization release** -- not a capability
expansion. The two-track rhythm continues:

- **Integrity track** -- alpha.55 SYSTEM WILL Preview monitoring
  window and alpha.56 adjacent-surface escape parity monitoring
  window both remain open.
- **Capability track** -- alpha.57 monitoring window opens for the
  `examples` catalog and the four shape-aware error messages.

Watch for:

- Operators still arriving at a shape-mismatch error without
  reaching `usesteady examples` (could indicate the error-message
  pointer is being missed; would be a wording iteration, not a
  parser change).
- Confusion about the auto-wrap behavior of `run <file>` (it
  accepts all three shapes; `--json` and `batch` only accept
  their own). Surfaced by the `examples` catalog explicitly.
- Operators trying invocation shapes that aren't on the list
  (e.g. `--json @file.json`, `run <ops-array-stdin>`); these
  remain unsupported by design and should produce the existing
  error paths.
- Any new render surface bypassing the four error-message
  addendums.

When this monitoring window resolves without signal, the next
capability NOW pick remains section 3.11 workflow health
diagnostics or section 3.6 execution timeline per the prior
preference order, selected against observed signal.

---

## 0.1.0-alpha.56 - Adjacent-surface trust-language consistency

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

**Trust-consistency refinement release. No new capability surface.
No authority-model change.** This is the final trust-clarity
stabilization pass before opening another capability surface.

### What this release fixes

The alpha.55 walkthrough closed the SYSTEM WILL trust gap for the
`Preview:` block, but the real fresh-install pass exposed three
remaining gaps at adjacent pre-approval surfaces:

- **F-A55-1** -- pre-approval intake echo (`[ok] Step N: Append
  "<value>" to <file>`) forged a second visual line whenever
  `<value>` contained a newline. The Preview block immediately
  below rendered the same content correctly. A user reading both
  saw two different representations of the same string.
- **F-A55-2** -- `You asked:` line inside `task_ready` and
  `task_conflict` had the same root cause: the canonical input
  string carries user content verbatim, including embedded
  newlines, and was rendered without inline escaping.
- **F-A55-3** -- pre-approval glyph was `[ok]`, which read as
  "completed successfully" -- the same semantic shape the
  COMPLETED frame's `[done]` glyph already owns. A first-time
  user could conclude a step had already run before any approval
  prompt.
- **F-A55-4** -- `templates append-to-file` safety note told the
  operator to verify the target file exists, while runtime
  creates the file if missing. Pre-existing wording misalignment;
  not introduced by alpha.55 but visible at the new Preview
  surface.

### What ships

Render-only changes. No execution-engine, planner, approval-model,
operation-set, dependency, spec-hash, replay, or audit-envelope
changes.

#### One shared primitive

New module `src/shell/render-escape.ts`. Single source of truth for
the escape rule and for the lifecycle-stage glyphs every adjacent
surface uses.

- `escapeControlForInline(raw)` -- escapes `\t` / `\r` / `\n` as
  C-style escape sequences. Leaves `\` and `"` alone so
  canonical-form bytes are preserved (the intake parser depends
  on those characters retaining grammar meaning).
- `LIFECYCLE_PARSED = "[parsed]"`, `LIFECYCLE_NEEDS_CONFIRMATION
  = "[ ? ]"`, `LIFECYCLE_DONE = "[done]"` -- glyph constants for
  the lifecycle stages.

Pure, deterministic, zero deps. The Preview block's `previewInline`
now delegates control-char escaping to this primitive so all
adjacent surfaces share one byte-level escape contract.

#### F-A55-1 -- intake echo escapes user content

`formatDraftTask` (`src/shell/cli/draft/intent-to-tasks.ts`)
routes every user value (`task.from` / `task.to` / `task.file` /
`task.rawText`) through `escapeControlForInline`. Multi-line
content can no longer forge a second visual line in the
pre-approval echo.

#### F-A55-2 -- You asked: anchor escapes user content

`truthfulInputDisplay` (`src/shell/workflow-render.ts`) escapes
the raw NL input via the shared primitive. The `structuredReplace`
path additionally escapes `\` and `"` first (existing behavior),
then control chars. `You asked:` is now single-line for any user
content while remaining truthful (the line still contains the
exact bytes the operator typed, only made inline-safe).

#### F-A55-3 -- lifecycle glyph clarification

Three intake-echo sites in `src/shell/cli/use-steady.ts`:

- `[ok] Step N: ...` -> `[parsed] Step N: ...`
- Section header changes from "I translated your request into
  safe steps:" to "Parsed your request into safe steps (not yet
  executed):"
- The `needs_confirmation` case becomes `[ ? ]` to stay visually
  separated from parsed steps.

No state-machine change, no execution path change -- only the
visible tag and the section header.

#### F-A55-4 -- template / runtime wording alignment (PR #306)

Two `usesteady templates` safety-note misalignments closed:

- `append-to-file` safety note now says "If the target file does
  not exist, it will be created" instead of "verify the target
  file path exists before approving".
- `git-safe-review-flow` safety note now says `create` on an
  existing file is refused with `target_exists` instead of
  ambiguous "is treated as ambiguous".

Both notes now match runtime behavior in
`src/cursor/adapters/inprocess-adapter.ts`.

### Lifecycle vocabulary after this release

| Stage | Glyph | Surface |
| --- | --- | --- |
| parsed/prepared | `[parsed]` | pre-approval intake echo |
| needs-confirm | `[ ? ]` | unparseable clause |
| review | numbered, no glyph | REVIEW frame |
| approve | `->` | SYSTEM WILL anchor |
| completed | `[done]` | terminal COMPLETED frame |

No two stages share a glyph. `parsed != approved != completed` is
now visually guaranteed.

### Friction -> Fix mapping (walkthrough-grounded)

| Friction observed in alpha.55 walkthrough | Fix in alpha.56 |
| --- | --- |
| Intake echo forged visual lines for multi-line content | `formatDraftTask` routes through `escapeControlForInline` |
| `You asked:` line forged visual lines for multi-line content | `truthfulInputDisplay` routes through `escapeControlForInline` |
| `[ok]` glyph readable as "completed" before approval | `[parsed]` glyph + "(not yet executed)" header |
| Template safety notes contradicted runtime behavior | PR #306 wording alignment |
| Adjacent surfaces rendered same content differently | Shared escape primitive used by all three surfaces |

### Authority story

The renderer remains pure. The shared escape primitive is a
5-line pure function. The Preview block, the `You asked:` anchor,
and the intake echo all consume the same primitive so a single
byte-level escape contract governs every pre-approval render
surface. The workflow spec hash (Row 2) continues to cover the
spec end-to-end; the preview cannot drift from execution without
the hash mismatching and the run aborting before any filesystem
effect.

No new authority surface. No new operation type. No new approval
mode. No semantic interpretation, no AI summarization, no
autonomous decision-making.

### What does NOT change

- Execution engine: byte-identical to alpha.55.
- Planner: byte-identical.
- Approval model: `task_ready` still produces a `confirm` prompt;
  nothing is auto-approved.
- Operation set: same 8 operation types.
- Dependencies: zero additions.
- Spec hash semantics, replay, audit envelope: byte-identical.
- Pre-alpha.56 fixtures (no control chars in user content) render
  byte-identically.

### Tests

`tests/shell/adjacent-surface-consistency.test.ts` -- 46 new
tests:

- `escapeControlForInline` primitive: newline / CR / tab / CRLF /
  multi-control / idempotence / determinism / single-line
  guarantee / empty-string identity / backslash and quote
  preservation.
- F-A55-1: `formatDraftTask` escapes every value for every op
  type (append / prepend / replace / rename / create / delete /
  run_command / needs_confirmation).
- F-A55-2: `task_ready` and `task_conflict` `You asked:` anchors
  never include literal newlines; `structuredReplace` path
  escapes from/to control chars.
- Backward compat: non-control input renders byte-identically to
  pre-alpha.56 (phase-11d fixture regression guard).
- Cross-surface parity: 9 representative content samples; inline-
  escaped bytes match across intake echo, `You asked:`, and
  Preview content.
- Block vs inline: multi-line content uses Preview block mode AND
  single-line escaped `You asked:` simultaneously.
- F-A55-3: glyph constants correct and pairwise distinct.
- Approval-semantics regression guard: `task_ready` still
  produces a `confirm` prompt; render is pure.

PR #306 also added 4 wording-alignment tests on
`tests/shell/templates.test.ts`.

Full suite: 4844 passed, 4 pre-existing skips. No regressions in
`phase-11d` / `workflow-coordinator` / `shell-workflow-render` /
`system-will-preview` / `templates` / `quickstart` /
`capabilities` suites.

### Release engineering

- `npm run release:gate` continues to use `test:release` with
  `--retry=2` for pre-existing test-order-dependent shell-spawn
  flakes documented in alpha.52 release engineering notes.
- `check-stdin-ownership` continues to scan git-tracked files
  only.

Implementation PRs:

- `shortgigs/usesteady-core#306` -- template / runtime wording
  alignment.
- `shortgigs/usesteady-core#309` -- adjacent-surface render
  consistency (F-A55-1 / F-A55-2 / F-A55-3).

### Posture after alpha.56

This is the **final trust-clarity stabilization pass** before
opening another capability surface. The two-track rhythm
continues:

- **Integrity track** -- monitoring window for the alpha.55
  Preview block remains open; alpha.56 monitoring window opens
  for the adjacent-surface escape parity and lifecycle glyph
  vocabulary.
- **Capability track** -- when the alpha.56 monitoring window
  resolves, the next bounded NOW pick remains section 3.11
  workflow health diagnostics or section 3.6 execution timeline,
  selected against observed signal.

Watch for:

- Confusion at the lifecycle vocabulary (parsed vs done vs review
  vs approve).
- Operator running into the escape rule unexpectedly (e.g.
  literal `\n` in a string they wanted to be a real newline).
- Adjacent-surface parity at large N (>5 tasks) review frames.
- Any new render surface added in the next capability work that
  bypasses the shared primitive.

No proactive next capability surface this cycle. Trust-language
coherence is the deliverable.

---

## 0.1.0-alpha.55 - SYSTEM WILL preview block (trust-clarity refinement)

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

**Not a new capability release.** A focused usability and explain-
before-execute trust refinement. Renderer-only change. The
execution engine, planner, approval model, operation set, and
dependency set are byte-identical to alpha.54.

### What this release fixes

The alpha.54 fresh-install walkthrough exposed a real onboarding-
tail gap: at the `APPROVE?` frame for an `append` operation,
`SYSTEM WILL` showed only the headline ("Append to NOTES.md") and
the raw user input. The literal text being appended, the target
file, and the file-creation behavior were all absent at the exact
moment the operator was being asked to approve. Trust clarity
collapsed at the highest-leverage approval surface.

### What ships

A deterministic `Preview:` block embedded in the `task_ready` and
`task_conflict` frames, plus a per-task summary in the `reviewing`
phase. All preview content is sourced from the same
`WorkflowTaskSpec` structured fields the executor consumes.

For an append op the operator now sees, before approving:

```
  SYSTEM WILL
  -> Append to NOTES.md
  You asked:  append "hello from usesteady" to NOTES.md
  Preview:
    Operation: append (text added to end of file)
    Target:    NOTES.md
    Content:   "hello from usesteady"
    File note: If NOTES.md does not exist, it will be created.
```

Per op type, the preview answers four questions: what kind of
change, where, what literal text (verbatim, never paraphrased),
and whether a missing/existing file changes runtime behavior.

| Op | Shape | File note (mirrors runtime) |
| --- | --- | --- |
| `append_file` | Operation / Target / Content | "If <file> does not exist, it will be created." |
| `prepend_file` | Operation / Target / Content | same |
| `write_file` | Operation / Target / Content | "If <file> already exists, the operation will fail (target_exists)." |
| `replace` | Operation / Target / From / To | (no file note) |
| `rename` | Operation / From / To | "If <newPath> already exists, the operation will fail (target_exists)." |
| `delete_file` | Operation / Target | "Deletion is permanent within this workspace; verify the path." |
| `create_dir` | Operation / Path | (no file note) |
| `run_command` | Operation / Command | (no file note) |

The `reviewing` phase keeps the existing `    N. [runtime] label`
header byte-for-byte (phase-11d tests assert on the numbering
format), adds an indented compact summary beneath each task, and
inserts a thin `    -----` separator between adjacent tasks.
Single-task workflows render no separator. Unstructured (raw NL)
tasks render the header only.

### Deterministic truncation

- Inline content > 72 chars: visible head + `(truncated; N chars total)`.
- Multi-line content: `Content (L lines, M chars):` header, body lines
  prefixed `| `, capped at 6 lines and 76 chars per line, tail
  `K more lines truncated` with singular/plural agreement.
- C-style escapes (`\t`, `\r`, `\n`, `\"`, `\\`) so multi-line
  values cannot forge new visual lines inside an inline preview.

### Friction -> Fix -> Invariant mapping

The walkthrough-recorded friction items closed by alpha.55:

| Friction (walkthrough) | Coverage | Invariant improved |
| --- | --- | --- |
| Append content invisible at approval | Full | Preview block sourced from spec, not from intake interpretation. |
| File-create behavior implicit | Full | Each preview includes the runtime statement (`will be created` / `target_exists` / `permanent`). |
| Batch workflows blurred together at review | Full | `reviewing` phase per-task block + N-1 separator. |
| Long content risked terminal flood | Full | Deterministic truncation rules with explicit char/line counts. |
| Multi-line content could forge visual lines | Full | C-style escape for tab/CR/newline/quote in inline previews. |

### Authority story

The renderer remains pure (WS1). The preview is read from the same
`WorkflowTaskSpec` fields the executor consumes. The workflow spec
hash (Row 2) covers that spec end-to-end, so the preview cannot
drift from the executed change without the hash mismatching and
the run aborting before any filesystem effect.

The preview never paraphrases content; the operation-kind label is
a fixed factual constant per type. No semantic interpretation, no
AI summarization, no autonomous decision-making.

### What does NOT change

- Execution engine: byte-identical.
- Planner: byte-identical.
- Approval model: `task_ready` still produces a `confirm` prompt;
  nothing is auto-approved.
- Operation set: same 8 operation types as alpha.54.
- Dependencies: zero additions.
- Hidden execution: still zero.
- Autonomy: still zero.
- Spec hash semantics, replay, audit envelope: byte-identical.

### Tests

`tests/shell/system-will-preview.test.ts` - 41 new tests covering:

- Per-op preview rendering (all 8 op types).
- File-create messaging assertions per type.
- Inline truncation at 72 chars; multi-line block at 6 lines / 76
  chars; singular/plural wording.
- Escape rules for `\t`, `\r`, `\n`, `\"`, `\\`.
- Fallback to `[]` for raw NL / missing fields.
- `task_ready` ordering invariant (SYSTEM WILL -> headline ->
  You asked -> Preview).
- `task_conflict` parity (same preview before
  `System will execute on approval.`).
- `reviewing` phase: 1-based numbering preserved (regression
  guard), `[cursor]` / `[claude]` tags preserved, N-1 separators
  for N tasks, single-task no separator, mixed structured /
  unstructured tasks.
- Byte-determinism across calls.
- Renderer purity (no run mutation).
- Confirm prompt still required.

Full suite: 4794 passed, 4 pre-existing skips. No regressions in
`phase-11d` / `workflow-coordinator` / `shell-workflow-render`.

### Release engineering

- `npm run release:gate` continues to use `test:release` with
  `--retry=2` for the pre-existing test-order-dependent shell-
  spawn flakes documented in alpha.52 release engineering notes.
- `check-stdin-ownership` continues to scan git-tracked files only.

Implementation PR: `shortgigs/usesteady-core#307`.
Implementation module: `src/shell/workflow-render.ts`
(`operationPreviewLines`, `operationReviewSummaryLines`, plus
`previewInline` / `previewBlock` helpers).

### Posture after alpha.55

Trust-clarity refinement releases complete a friction -> fix -> release
cycle from a real walkthrough. The next cycle starts with another
real walkthrough on alpha.55. Hold for one operational cycle:

- Watch for confusion at the new Preview surface (off-spec
  expectations, line-cap surprises, escape misreads).
- Watch for `reviewing` phase readability issues at large N (>5
  tasks).
- Watch for truncation complaints (does a real user need a way to
  see the full content before approval, or do they need to abort
  and re-author the spec).

No proactive next capability surface this cycle. Trust-clarity
refinements compose with onboarding; the next bounded NOW pick
remains 3.11 workflow health diagnostics or 3.6 execution timeline,
selected when the alpha.55 monitoring window resolves.

---

## 0.1.0-alpha.54 - Onboarding quickstart and starter templates

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

Second ship from the **Product Capability Track**. Goal: a brand-new
user can go from install to a successful, reviewed workflow in under
five minutes, without reading internal docs. Bounded scope: two new
read-only subcommands and a README walkthrough. Zero authority impact.

### What ships

Three onboarding surfaces, all read-only:

- `usesteady quickstart` - one-screen orientation. What UseSteady is,
  how to discover capabilities, how to pick a template, how to
  customize and run, plain-language approval explanation, where
  workflows execute, and how to stop safely. Pure text renderer;
  byte-for-byte deterministic.
- `usesteady templates` - prints a list of safe starter workflows
  with one-line purposes.
- `usesteady templates <name>` - prints one template in detail
  (purpose, required/optional fields, example values, safety notes,
  runnable JSON operations). `--output json` for machine-readable.

Five initial templates:

| Template | Operations |
|---|---|
| `append-to-file` | `append` |
| `safe-rename` | `rename` |
| `multi-file-replace` | `replace` (x3) |
| `non-destructive-cleanup` | `create_dir` + `rename` (x2) |
| `git-safe-review-flow` | `create` + `append` |

**No starter template uses `delete` or `run`.** Tests enforce this:
starter templates are deliberately non-destructive and command-free.
Every operation in every template is a member of `ALL_OPERATION_TYPES`
(`src/input/op-registry.ts`); the registry is the single source of
truth and tests assert there is no second op list to drift against.

README adds a "First 5 Minutes with UseSteady" section that walks
the exact happy path: `quickstart` -> `capabilities` -> `templates` ->
customize -> `batch` run -> approval / stop. No internal-doc
references required.

Implementation PR: `shortgigs/usesteady-core#304`.
Implementation modules: `src/shell/cli/quickstart.ts` and
`src/shell/cli/templates.ts` (pure functions only; no I/O, no
`process.exit`, no execution).

### Friction -> Fix -> Invariant mapping

The Product Capability Track frictions are internally referenced as
F-1..F-9 in the design doc. This release closes:

| Friction (track ref) | Coverage | Invariant improved |
|---|---|---|
| F-1 Manual batch JSON loading | full | Operators can copy a complete runnable JSON operation set from any template; no hand-crafting from registry summaries. |
| F-7 Unclear first-run path | full | `usesteady quickstart` is the documented first command. README "First 5 Minutes" walks the full path without internal-doc references. |
| F-8 Command authoring friction | full | Templates surface required/optional fields, example values, and safety notes for each starter workflow before invocation. |
| F-2 Workflow scaffolding gap | partial | Five non-destructive templates cover the most common safe starting patterns. Custom workflows still require hand-authoring; that gap is deliberate. |
| F-5 Approval surprise / opaque flow | partial | Quickstart explains the approval gate, `--yes` semantics, and how to stop safely in plain language; the runtime approval surface itself is unchanged. |

### Authority story

- Deterministic approval model: unchanged.
- No hidden execution: both new subcommands only print. Quickstart
  renders static text. Templates renders static catalog data. Neither
  module imports the planner, the safety gate, the executor, or any
  approval surface.
- No autonomous authority expansion: no new authority granted. The
  set of executable operations did NOT grow. Only inspection
  surfaces grew.
- Explain-before-execute: strengthened. Operators now see a
  pre-formatted, safety-noted recipe before authoring a workflow.
- Bounded execution semantics: unchanged. Templates are static data;
  printing a template is not running one.
- `--yes` semantics: unchanged. `quickstart` and `templates` join
  `capabilities` in the documented `--yes`-exempt list because they
  never execute. Every other path still requires `--yes` for
  `--output json` execution.

### What does NOT change

- No `src/input/` change. No registry change. No IR change.
- No safety detector, drift detector, sanitizer, or canonicalizer
  change. PRs #293 / #294 / #297 surfaces are untouched.
- No execution engine change. Planner, executor, and approval
  surfaces are byte-identical to alpha.53.
- No new operation types. Templates compose only operations from the
  existing `ALL_OPERATION_TYPES`.
- No new runtime dependencies.
- No model-insertion path change. No new prompt surfaces. No AI
  workflow generation. Templates are hand-authored static data.
- No edits to ShortGigs, YODHA, StructureGuard, or SteadyHealth.

### Tests

73 of 73 tests pass across the three onboarding-adjacent surfaces:

- `tests/shell/capabilities.test.ts` (17, regression)
- `tests/shell/templates.test.ts` (41 new)
- `tests/shell/quickstart.test.ts` (15 new)

Key invariants enforced by tests:

- Every operation in every template uses a registered op type.
- No starter template uses `delete` or `run`.
- Quickstart text and template output are byte-for-byte deterministic.
- `--output json` works without `--yes` on all three read-only paths.
- Unknown template names exit non-zero with a helpful stderr line.
- Negative-content guarantees on quickstart: no "autonomous", no
  "ai will fix", no "agent will" language anywhere in the orientation.

### Release engineering

No changes to the release gate. `test:release` retains the `--retry=2`
flake mitigation from alpha.52. `check-stdin-ownership` runs the same
git-tracked-only scan.

### Surface-specific monitoring

Stabilization window for the onboarding surface opens with this
release. Watch for:

- Confusion in the quickstart text (specific lines that mislead a
  first-time user).
- Template copy/paste failures (JSON that doesn't parse cleanly
  when pasted, escape-sequence misreads).
- Approval-flow surprises after following the quickstart (anything
  the operator sees at run time that the quickstart did not prepare
  them for).
- Trust/perception issues (any place where the operator cannot tell
  whether something is "just printing" or "about to run").

If real friction surfaces in this window, one bounded follow-up PR
ships. No multi-candidate expansion.

---

## 0.1.0-alpha.53 - Capability explorer (first Product Capability Track ship)

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

First implementation candidate from the **Product Capability Track**
(`docs/product/useability-and-guided-execution-track.md` section 3.1,
merged in shortgigs/usesteady-core#299). Bounded scope: one new
read-only subcommand. Zero authority impact.

### What ships

`usesteady capabilities` - prints a structured catalog of every IR
operation this build supports. Reads directly from
`src/input/op-registry.ts` (`ALL_OPERATION_TYPES` +
`OPERATION_REGISTRY`); no second source of truth.

- Default output: human-readable text.
- `--output json`: deterministic single-line JSON catalog. Exempt
  from the global `--output json` + `--yes` rule because the
  catalog has no execution path; `--yes` is meaningless for it.
- `--help` on the subcommand: subcommand-specific usage.
- Listed in `PURE_SUBCOMMANDS` (no stdin sampling).
- Listed in `HELP_TEXT` for global discoverability.

Implementation PR: `shortgigs/usesteady-core#300`.
Implementation module: `src/shell/cli/capabilities.ts` (pure
functions only; no I/O, no `process.exit`, no execution).

### Friction -> Fix -> Invariant mapping

The Product Capability Track frictions are internally referenced
as F-1..F-9 in the design doc (not public issue numbers, since
they were proactively identified rather than reported). This
release closes:

| Friction (track ref) | Coverage | Invariant improved |
|---|---|---|
| F-9 Weak discoverability of supported operations | full | Every operation the build supports is enumerable from inside the product itself. No external doc lookup required. |
| F-1 Manual batch JSON loading | partial | Operators can copy a public-JSON shape from the catalog instead of hand-crafting from source. Curated workflow templates (track section 3.2) remain queued. |
| F-8 Command authoring friction | partial | Required and optional fields per op surface before invocation. Authoring errors are now visible at catalog read time, not at safety-gate-rejection time. |

### Authority story (preserved verbatim from track section 6)

- Deterministic approval model: unchanged. Catalog never approves.
- No hidden execution: catalog cannot mutate state. No side effects
  on import or invocation.
- No autonomous authority expansion: no new authority granted.
- Explain-before-execute: unchanged.
- Replayability: unchanged.
- Bounded execution semantics: the set of executable operations did
  NOT grow. Only the surface to **inspect** them grew. This
  distinction is load-bearing (track section 6.6).

### What does NOT change

- No `src/input/` change. No registry change. No IR change.
- No safety detector, drift detector, sanitizer, or canonicalizer
  touch.
- No approval state machine change.
- No UCP envelope schema change.
- No K5 boundary change. No `MODEL_INSERTION_POLICY` touch.
- No new doctrine, ADR, or governance document.
- No NL-intake involvement. The catalog is built from the static
  registry, not from any model.

### Tests

- `tests/shell/capabilities.test.ts` (new): 17 tests covering
  invariants I1..I7 (catalog coverage of `ALL_OPERATION_TYPES`,
  deterministic byte-for-byte output, `--yes` not required,
  `--output json` works without `--yes`, every op has a parseable
  JSON example, catalog is frozen, registry fields surface
  verbatim).
- No existing test modified. Governance test
  (`tests/governance/input-surface-integrity.test.ts`) and registry
  test (`tests/input/op-registry.test.ts`) unchanged: 141/141 pass.

Full suite: 4697 passed, 4 skipped (132 files).

### Public demonstration

`README.md` updated with a "Discover what UseSteady can do"
section under Install, showing the command, its output, and the
`--output json` variant. The README explicitly notes the catalog
shares the same registry the executor uses (no doc drift).

### Sequencing posture

- Product Capability Track NOW queue: section 3.1 SHIPPED in this release.
  Remaining NOW: section 3.2 (curated templates), section 3.6 (execution
  timeline view), section 3.11 (workflow health diagnostics). Per track
  section 7, one PR per candidate; the next NOW candidate opens only
  after this surface stabilizes through one monitoring window.
- Cluster B (alpha.52) monitoring window: still active through
  2026-05-18 unless triggers fire. This release does not touch
  any Cluster B surface; window unaffected.
- `capabilities` opens its own observation window on landing.
  Read-only surface; thresholds calibrated narrow:
  - regression trigger: any deterministic-output drift, any
    catalog coverage gap (op missing or extra), any exit-code
    change.
  - volume trigger: 3+ reports of operator confusion mapped to
    F-9 / F-1 / F-8 within 14 days indicating the catalog is
    surfacing the wrong information.

### Release engineering

No changes to `scripts/check-stdin-ownership.mjs` or
`release:gate`. The alpha.52 release-engineering deltas (scanner
gitignore-respect; `vitest run --retry=2` in `release:gate`)
remain in place.

---

## 0.1.0-alpha.52 - Canonicalization, Workflow Integrity, Process Lifecycle Anchor

**Released:** May 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

Three implementation-level fixes plus one definitional anchor. All three
fixes share a common invariant theme - surface-spanning consistency -
applied across distinct axes:

- Row 1 (PR shortgigs/usesteady-core#293): input canonicalization in
  front of every safety detector.
- Row 2 (PR shortgigs/usesteady-core#294): deterministic workflow spec
  hash with revalidation before every advancement.
- Cluster B (PR shortgigs/usesteady-core#297): extends the Row 1
  canonical view to four adjacent surfaces where two views of the same
  string could otherwise diverge.
- Cluster A anchor (PR shortgigs/usesteady-core#296): docs-only
  definitional anchor for CLI process lifecycle authority. No runtime
  code in this release. Implementation gated on this design.

### Friction -> Fix -> Invariant mapping (Cluster B)

This release closes the implementation-ready portion of Cluster B from
the May 2026 friction wave. The cluster map for the wave lives at
`shortgigs/usesteady-public#75`.

| Friction | Issue | Severity | Fix surface | Invariant improved |
|---|---|---|---|---|
| U+202E in filename accepted without validation | shortgigs/usesteady-public#50 | P0 | `pathEscapesWorkspace` (filename validation) + OCD path comparison + adapter `allowedFiles` check | A path that escapes the workspace in canonical form is refused even when the original-form regex would have let it through. Adjacent surfaces (validator, OCD, adapter) see the same canonical interpretation. |
| Literal string matching ignores Unicode normalization (NFC vs NFD) | shortgigs/usesteady-public#51 | P2 | `inprocess-adapter.receive` replace-match: canonical/original occurrence-count gate | Original-form and canonical-form occurrence counts must agree before a replace is allowed. NFC vs NFD divergence is detected and refused rather than silently mis-matching. |
| U+202E in replacement text accepted | shortgigs/usesteady-public#52 | P0 | `inprocess-adapter.receive` replace-match gate; `searchForOldValue` cross-file gate | Replace `oldValue` must canonicalize to itself; a `oldValue` whose canonical form differs is refused (`ambiguous_match`, "match-count mismatch"). Same gate applies to multi-file search. |
| Mixed-script homograph filenames (Cyrillic vs Latin) | shortgigs/usesteady-public#53 | P2 | Partial - Cluster B catches mixed-script when combined with other obfuscation (canonical-form path comparison divergence); pure NFKC does NOT fold scripts | This release does NOT fully resolve pure-script homograph spoofing. NFKC normalization is the wrong tool for script-level confusion. The issue remains `status/accepted` pending a separate script-detection track. |

### Row 1 - Input canonicalization (foundation)

Source: SafeHarness research finding (`docs/architecture/usesteady-safeharness-hardening-map.md`, Row 1). No specific friction issue.

What changes:
- New module `src/safety/canonicalize.ts` exporting
  `canonicalizeForSafety` and `CanonicalizationError`.
- Transform (fixed order): NFKC normalize -> strip zero-width
  codepoints (U+200B, U+200C, U+200D, U+2060, U+FEFF) -> strip
  bidirectional controls (U+200E, U+200F, U+202A-U+202E,
  U+2066-U+2069).
- Hooked at: `src/safety/safety-gate.ts` (canonicalize before every
  detector), `src/control/compiler.ts` (canonicalize `rawRequest`,
  `plannedChanges.summary[]`, `plannedChanges.files[]` before the
  drift detector).
- Fail-closed: `CanonicalizationError` produces a blocked verdict
  with reason `evasion_or_rule_bypass` (safety gate) or
  `canonicalization_failed` (control compiler).
- Original (raw) strings are preserved on audit fields verbatim.

Invariant: detectors see the canonical form; audit retains the raw
form. Replay determinism unchanged.

### Row 2 - Workflow spec deterministic hash + revalidation

Source: SafeHarness research finding (hardening map Row 2). No
specific friction issue.

What changes:
- New module `src/workflow/spec-hash.ts` exporting
  `computeWorkflowSpecHash` and `verifyWorkflowSpecHash`.
- `WorkflowRun` carries `workflowSpecHash: string` (set at
  `createWorkflowRun`, never mutated).
- `advanceWorkflow` and `deliverWorkflowTask` revalidate the hash
  before every transition. Mismatch aborts the run.
- Hash stays in execution/session metadata only. No signing system,
  no distributed trust, no network dependency.

Invariant: the executing run is bit-for-bit the run that was
approved. Spec drift between approval and execution aborts rather
than executing silently.

### Cluster A - CLI process lifecycle authority boundary (anchor only)

Source: friction wave issues shortgigs/usesteady-public#70-#74.

What changes:
- New design document `docs/architecture/cli-process-lifecycle-authority-boundary.md` (390 lines).
- Defines the load-bearing invariant: a CLI invocation's authority
  over OS processes is limited to the invocation interval; every
  spawned process must terminate within the interval or be
  explicitly enumerated as an authorized outlive-exception.
- Names two violation classes (unauthorized outliving, unauthorized
  invocation replacement via `exec`); defines a closed-class
  outlive-exception mechanism shape; sketches the containment
  surface (per-invocation process registry + syscall refusal list
  + teardown protocol).
- NOT implemented in this release. Implementation is gated on the
  decisions in section 11 of the design document.

Invariant established (not yet enforced): no process whose
existence cannot be accounted for by the operator at invocation-end
is authorized.

### What does NOT change

- No new approval state, UCP envelope schema, or ControlEnvelope
  schema.
- No SafetyResult schema change. No detector logic change.
- No K5 boundary change. No MODEL_INSERTION_POLICY change.
- No replay determinism change.
- No new doctrine file. No new ADR.
- No autonomous-execution surface. No semantic-review surface.
- No NL grammar change.

### Tests

- `tests/safety/canonicalize.test.ts` (new with Row 1): 28 tests.
- `tests/safety/safety-gate.test.ts`: +8 tests for canonicalization
  bypass attempts (clean inputs unchanged).
- `tests/control/control-envelope.test.ts`: +6 tests for canonical
  control compilation.
- `tests/workflow/spec-hash.test.ts` (new with Row 2): 14 tests.
- `tests/workflow/workflow-coordinator.test.ts`: +existing
  revalidation coverage.
- `tests/safety/canonicalize-adjacent-surfaces.test.ts` (new with
  Cluster B): 44 tests across all five required categories (U+202E,
  NFC/NFD equivalence, BIDI controls, replacement-text matching,
  filename/path denylist).

Full suite: 4680 passed, 4 skipped.

### Release engineering

- `scripts/check-stdin-ownership.mjs` now scans only git-tracked files
  via `git ls-files src`. Locally-added or `.gitignore`'d tools (e.g.
  the proprietary `friction-admin.ts` that ships in a separate repo)
  no longer trip the public single-stdin-owner invariant guard. Falls
  back to scanning everything when `git` is unavailable.
- `npm run release:gate` now runs `vitest run --retry=2` instead of
  `vitest run`. Local `npm test` is unchanged. The retry is bounded
  and only papers over stochastic process-spawn races in tests that
  shell out to the CLI; a test failing three times in a row is still
  a real failure.

### Issue label transitions

After publish, the following issues transition from
`status/accepted` to `status/shipped` in
`shortgigs/usesteady-public`:

- #50, #51, #52 (Cluster B fixes shipped here)

The following remain `status/accepted` pending further work:

- #53 (Cluster B partial; pure-script homograph spoofing requires
  a separate detection track)
- #70-#74 (Cluster A; anchor landed, implementation deferred)
- All other May 2026 wave issues (clusters C-H and lower-priority
  distinct items)

---

## 0.1.0-alpha.51 - S4: Trust & Surface Integrity Completion

**Released:** April 2026
**npm tag:** `alpha` - `npm install -g usesteady@alpha`

Stabilization Pass 4 (S4). Closes friction reports #44 (P1, Input
Surface Integrity), #42 (P2, Trust frame), #43 (P3, Trust display).
Issue #41 (batch rollback) remains parked.

### Breaking change - R4 uniform (Option alpha)

Pre-S4 the WorkflowSpec input surface accepted bare-NL `replace` forms
without an explicit occurrence clause:

```jsonc
{ "tasks": [{ "input": "replace \"X\" with \"Y\" in file.ts" }] }
```

The legacy coordinator NL fallback (`parseChange`) silently treated
this as "first occurrence." The same NL string typed at `--prompt` was
already rejected with R4 ("explicit occurrence required") - so
identical NL input behaved differently across surfaces, breaking the
alpha.49 contract: *same NL string -> same behavior everywhere*.

S4 closes the gap. `normalizeNLToIR` is now the single NL parser;
`tasks[].input` is normalized at spec-load time; R4 is enforced
uniformly across `--prompt`, `WorkflowSpec`, and any future NL
surface. No coordinator fallback. No spec-load shortcut. No hidden
public surface.

**Migration.** Any `replace` task in a `WorkflowSpec` MUST now include
an explicit occurrence clause:

| Before (now fails with `invalid_op`)     | After                                                           |
|------------------------------------------|-----------------------------------------------------------------|
| `replace "X" with "Y" in file.ts`        | `replace "X" with "Y" in file.ts first occurrence`              |
|                                          | `replace "X" with "Y" in file.ts all occurrences`               |
|                                          | `replace "X" with "Y" in file.ts <Nth> occurrence`              |

Programmatic alternatives are unchanged: pass `structuredReplace`
(`{oldValue, newValue, filePath}`) directly, or use a JSON op shape
(`{ "type": "replace", "file": ..., "from": ..., "to": ... }`) - both
already mean "first occurrence" by construction.

This is a controlled breaking fix in favor of trust consistency.

### What changed

**#44 - WorkflowSpec NL parity (P1, Input Surface Integrity)**

- New `src/shell/cli/spec-nl-synth.ts`. `loadWorkflowSpecFromFile`
  routes `tasks[].input` through `normalizeNLToIR` and synthesizes
  structured fields (`operationType`, `content`, `targetFiles`,
  `structuredReplace`, ...) at the input boundary.
- New shared `src/shell/cli/ir-to-spec-fields.ts` - single canonical
  `Operation -> WorkflowTaskSpec structured-fields` mapper, used by
  both the NL synthesizer and `buildSpecTasksFromIROps` so the JSON-op
  and NL paths cannot drift again.
- `src/workflow/coordinator.ts` no longer imports `parseChange` and
  no longer defines `hasDeterministicReplaceInput`. The runtime NL
  fallback inside `advanceWorkflow` is gone. `isDeterministicTaskSpec`
  only inspects structured fields.
- User-supplied `targetFiles` continue to win over synthesizer-
  produced ones; only synthesizer-derived fields fill gaps.

**#43 - `replace` placeholder lie (P3, Trust display)**

`src/shell/workflow-render.ts` adds `truthfulInputDisplay`. When a
task carries `structuredReplace`, the `You asked:` line is derived
from `oldValue`/`newValue`/`filePath` - the executor's actual inputs
- instead of the parser-stable placeholder produced by
`buildSpecTasksFromIROps`. NL surfaces (where `input` is the literal
user text) are unchanged. Render-only transform; `taskSpec.input`
stays parser-stable so intake classification is unaffected.

**#42 - OCD `CONFLICT` frame (P2, Trust frame)**

`task_conflict` header renamed: `CONFLICT` ->
`WARNING - OCD conflict detected (non-blocking)`. Frame body now ends
with `System will execute on approval.` so the rendered severity
matches the actual gate (the system never blocks; H gates). Confirm
prompt updated to `Accept warning and approve task? (y/n)`. Pure
renderer change. State machine, OCD evaluator, and policy untouched.

### Governance lock extension

`tests/governance/input-surface-integrity.test.ts` adds:

- WorkflowSpec NL parity assertions ("same NL string -> same
  behavior everywhere"): every form `--prompt` rejects is also
  rejected via `loadWorkflowSpecFromFile`; every form it accepts
  synthesizes the same `operationType`.
- Structural invariants: `src/workflow/coordinator.ts` no longer
  imports `parseChange` and no longer defines
  `hasDeterministicReplaceInput`. Future regressions caught at
  test time, not at runtime.

### Real proof (workflow-04)

`tests/governance/nl-real-workflow-replay.test.ts` adds workflow-04:
write a `WorkflowSpec` with a single NL `append` task, run
`usesteady run spec.json --yes`, verify file mutation, verify the
persisted artifact carries `operationType: "append_file"` (the smoking
gun for #44 - pre-S4 the artifact lacked this), and verify replay
match.

`labs/shortgigs-workflow-03/README.md` extends the locked runbook
with Spec D (`WorkflowSpec NL parity / S4 / #44`), pinning the same
proof against published binaries.

### Out of scope (locked)

#41 (batch rollback), executor changes, kernel changes, safety changes,
feasibility validator changes, NL grammar additions, K5, ShortGigs
integration, error code names, exit codes.

### Pre-publish gates

- `npm run build` -> ok
- `npm test` -> 4535 / 4539 pass, 4 skipped
- `npm run verify:pack-clean` -> ok (933 files, 0 private artifacts)
- Lab proof workflow-04 (post-merge on master) -> exit 0, file
  mutated, artifact `f97322b40320d473a7ad150a27ab38cc2d06735fc48a0c7cf3adad0c569a49c1`
  carries `operationType: "append_file"`, replay -> `match`
- Lab proof workflow-03 A/B/C/D (post-merge) -> all four specs
  succeed
- R4 negative path -> a WorkflowSpec replace without occurrence exits
  1 with `invalid_op` and the canonical migration message

## 0.1.0-alpha.43 - Kernel v1

**Released:** April 2026
**npm tag:** `alpha` - opt in with `npm install -g usesteady@alpha`
**Latest stable tag:** `0.1.0-alpha.4` (unchanged)

First alpha cut of the Kernel v1 trust surface. Nothing in the workflow
coordinator, approval model, safety gate, or policy engine changed. What
changed is the determinism surface the CLI now emits, how errors are
classified before they reach that surface, and how human output is
shaped at the end of a run. Landed as three kernel PRs plus one
release-gate hotfix.

### What changed

**Deterministic replay artifact (PR-K1, #239)**

Every successful CLI run now persists a content-addressed artifact at
`<storeDir>/replay/<checksum>.artifact.json` containing:

```
{ version, ir, result, checksum }
```

`ir` is the existing `WorkflowSpec` (reused, not reinvented). `result`
is a strictly deterministic summary (`success`, `error`,
`executed_steps`, `failed_at_step`, `total_steps`) - no timestamps, no
paths, no stdout, no randomness. `checksum` is `sha256` over the
canonical JSON of `{ ir, result }` with stable key ordering. Identical
runs produce identical filenames.

New subcommand `usesteady replay <artifact-file>` performs integrity
verification only:

```
{ "replay": "match" | "mismatch", "original_checksum": "...", "new_checksum": "..." }
```

No workflow re-execution, no `process.argv` mutation, no side effect
beyond reading the artifact file. Full execution replay is deferred.

**Canonical CLI error-code taxonomy (PR-K2, #240)**

A single closed `CanonicalErrorCode` enum now backs every error string
that reaches the final CLI summary, the kernel result, or the artifact
result. A central `finalizeErrorCode` choke point normalizes codes
before `_errorCode` materialization. Consensus-layer capture was widened
beyond `runtime === "cursor"` so Claude consensus codes survive to the
final surface.

No public shape change. `KernelResult.error` and the CLI JSON `error`
field stay `string | null`; the enum is internal. What changes is that
different failures no longer collapse into a generic `execution_error`.

**Single-voice human output (PR-K3, #241)**

Pre-PR-K3 every terminal run printed three different vocabularies to
stdout: a workflow-render frame, a `Terminal outcome:` classifier line,
and the PR-2 summary block. K3 keeps only the PR-2 summary block as the
user-facing final result. The `Terminal outcome:`,
`COMPLETED:`/`STOPPED_BY_USER:`/`FAILED_EXPLICIT:` lines no longer reach
stdout. `persistWorkflowTerminalOutcome` writes the record to disk
unchanged; classifier message strings in that record are identical;
exit codes propagate as before.

`loadWorkflowSpecFromFile` now throws `WorkflowSpecLoadError` with a
canonical K2 code and a single-sentence message (no Node-errno dialect,
no duplicated path). The interactive workflow/history banner is
suppressed under `--yes`; the `UseSteady ? Workflow` separator
(mojibake-to-`?`) is now clean ASCII `UseSteady - Workflow`.

One narrow JSON parity fix: `usesteady run <missing>.json --yes
--output json` now emits a canonical JSON error to stdout instead of
exiting silently with human stderr only. Other JSON parity gaps
(`batch`, `replay`, unknown-subcommand, `--output json` without
`--yes`) remain deferred.

**Release-gate hotfix (#242)**

K1 shipped two kernel files using `import fs from "node:fs"` default
imports, which the repo's `"esModuleInterop": false` tsconfig rejects.
On master `npm run build` exited 2 and silently broke `prepublishOnly`.
Switched to named imports (`mkdirSync`, `writeFileSync`, `join`,
`readFileSync`) - the style used elsewhere in `src/shell/cli/`. No
behavior change.

### What was not changed

- The workflow coordinator, approval model, and execution path
- The safety gate, detectors, and category routing
- The consensus policy and `ConsensusAuditRecord` type
- The public CLI summary shape (`success`, `error`, `failed_at_step`, `executed_steps`, `total_steps`)
- All INV-ML-, INV-CE- invariants
- The on-disk `WorkflowTerminalRecord` or its classifier strings
- Exit codes for any path
- The `SYSTEM WILL` format or any marketing surface

### Deferred to later kernel PRs

- Full execution replay (PR-K1 is artifact-integrity replay only)
- JSON parity for `batch`, `replay`, unknown-subcommand, and `--output json` without `--yes`
- Widening the canonical error taxonomy through the shadow envelope and terminal record (K2 D5)
- Conflict-frame retuning, REVIEW-frame dedupe, friction-footer coalescing, consensus-block output work (K3 non-goals)
- `ci(release): run npm run build in Repo validation` and `chore(release): wire release:gate into prepublishOnly` (governance follow-ups)

---

## 0.1.0-alpha.10 - UX Clarity Layer

**Released:** April 2026  
**npm tag:** `alpha` - opt in with `npm install -g usesteady@alpha`  
**Latest stable tag:** `0.1.0-alpha.4` (unchanged)

This release adds a clarity layer on top of the existing execution core. Nothing
in the coordinator, policy engine, or consensus system was changed. What changed
is everything the user sees before and after execution runs.

### What changed

**Draft Mode** (`usesteady "plain English instruction"`)

The CLI now accepts free-text input directly. It translates the intent into
structured steps, shows them with `OK` / `?` indicators, and asks for
confirmation before routing to the existing execution pipeline. Unrecognised
clauses are marked `needs_confirmation: true` and pass through with the original
text preserved - nothing is silently dropped.

**`usesteady help` command**

New `help` subcommand shows supported actions, exact formats, and an honest
description of plain-English input. Distinct from `--help`, which shows
command-line options.

**Consensus explanation in CLI**

After a workflow completes, the CLI prints a human-readable consensus result
when multi-model mode was active. Uses file-offset correlation so the output
matches this run only. Shows "Passed (N rounds)" on success, or the specific
disagreement reason (capability / scope / semantic) on block. No hashes or
internal enum names exposed.

**Intake failure guidance**

When one or more workflow steps are skipped by the intake parser
(`skipped_by_intake`), the completed/stopped CLI frame now appends the
supported format examples - matching the guidance already shown in the web UI.

**UI copy updates**

- Consensus indicator: `"multi | OK Unanimous 2r"` -> `"Multi-model check: OK Passed (2 rounds)"`
- Policy block label: `"Blocked by policy"` -> `"Blocked - models did not agree on execution"`

**Marketing site - story shift**

Landing page: new `FlowSection` with the four-step Describe -> Preview -> Approve
-> Execute flow. CLI demo updated to show Draft Mode. Consensus section updated
to show concrete pass/block examples instead of abstract architecture copy.

Docs page: restructured to be usable-first. New sections: Supported Actions,
Examples (six real commands), When Blocked (three reasons with fixes). No
internal terms, no invariant documentation, no architecture theory in the
user-facing path.

### What was not changed

- The coordinator, Forge execution loop, and all advance functions
- The multi-LLM consensus policy and `ConsensusAuditRecord` type
- All INV-ML-, INV-CE- invariants
- The `SYSTEM WILL` format
- The approval authority model - human approval required before every step

---

## 0.1.0-alpha.9 - Deterministic Execution Runtime

**Released:** April 2026  
**npm tag:** `alpha` - opt in with `npm install -g usesteady@alpha`  
**Latest stable tag:** `0.1.0-alpha.4` (unchanged)

This release formalises the execution layer that has been running in controlled
environments since the public alpha. The core guarantee - nothing runs without
explicit human approval - is unchanged. What is new is the architectural depth
behind that guarantee.

### What changed

**Deterministic workflow execution**

The workflow coordinator sequences approved tasks through a fixed state machine:
`approve -> execute -> observe -> resolve`. Every transition is explicit. No step
is inferred, skipped, or reordered. The same input produces the same approval
request every time.

**Optional multi-model policy enforcement**

When `USESTEADY_LLM_MODE=multi` is set, execution requests require agreement
across models before proceeding. Agreement is defined as matching normalised
decision hashes - not just multiple "accepted" responses. If models disagree,
execution is blocked. This is disabled by default.

**Fail-closed behaviour**

Policy disagreement is a hard stop, not a fallback. The system does not proceed
on partial agreement, does not fall back to a single model's verdict, and does
not silently degrade. When the policy layer blocks execution, the failure note
says why.

**Full audit trail**

Every execution decision is logged with its outcome, reason, and - in
multi-model mode - the consensus record for that request. The log is
append-only. Nothing that ran is absent from the record.

### Notes

- Multi-model mode is optional and inactive by default. Enable it with
  `USESTEADY_LLM_MODE=multi` and the appropriate API keys.
- No UI code is included in this package. The runtime is fully standalone.
- The approval authority model is unchanged. Human approval is required before
  any step executes, regardless of what the policy layer returns.
- Consensus verdicts are input signals to the coordinator. They do not override
  human approval authority.

### What was not changed

- The approval flow visible to users
- The `SYSTEM WILL` format
- The CLI interface
- Any existing workflow spec format

---

## 0.1.0-alpha.9 and earlier

See git history for the public alpha changelog.
