# Skills v1 Baseline — Loader / Validator / Invocation Freeze

> **Freeze statement:** UseSteady Skills v1 is frozen as a removable, auditable, zero-authority suggestion layer whose absence must never change deterministic control behavior.

**Status:** Frozen — April 2026
**Depends on:** Phase 11D baseline, Phase 12 simulation, Phase 13 web simulation
**Produces:** Integration slice (wire starter skills into unsupported/recovery paths — next phase)

---

## What this baseline captures

Skills v1 is a **zero-authority suggestion layer** added to UseSteady. It provides reusable, bounded translation modules that can assist interpretation, workflow drafting, and recovery — without touching control, approval, policy, or execution semantics.

This document freezes:

1. The seven implementation layers
2. All invariants that must hold if Skills code is ever modified
3. The allowed and prohibited integration points
4. The removal invariant (the single most important architectural test)

---

## Frozen system state at Skills v1 entry

| Layer | File | Status |
|---|---|---|
| Types + interfaces | `src/skills/types.ts` | frozen |
| Parser (zero-dep YAML + section extractor) | `src/skills/parser.ts` | frozen |
| Validator (full-pass, all issues) | `src/skills/validator.ts` | frozen |
| Loader / scanner | `src/skills/loader.ts` | frozen |
| Registry (kind lookup + trigger routing) | `src/skills/registry.ts` | frozen |
| Invocation boundary | `src/skills/invocation.ts` | frozen |
| Audit stub | `src/skills/audit.ts` | frozen |
| Test suite | `tests/skills/skills.test.ts` | frozen |
| Starter skill definitions | `skills/*/SKILL.md` (3 files) | frozen |

**No file in this list may be modified without opening a named Skills phase.**

---

## Core invariant — zero authority

Skills improve recall and recovery. They do not change:

- What the deterministic parser accepts or rejects
- What primitives UseSteady supports
- What steps reach the approval gate
- Whether approval is required
- Which policy rules apply
- How execution is performed
- What appears in the audit trail of actual execution

A skill output is a **suggestion to be validated**, not a command to be executed.
The invocation helper enforces this — it has no access to the executor, the session, or the approval state.

---

## Frozen invariants

### INV-SK-1 — Kind → schema mapping is locked

```
interpretation      → usesteady.intent_candidates.v1
workflow_generation → usesteady.workflow_draft.v1
recovery            → usesteady.recovery_suggestions.v1
```

`KIND_SCHEMA_MAP` in `types.ts` is the single source of truth. The validator enforces this at load time. The invocation layer re-checks at runtime. Any mismatch causes schema rejection with rawOutput preserved for auditing.

### INV-SK-2 — Guardrail booleans are literal and compile-time-enforced

All five guardrails must be present in every SKILL.md and set to exactly:

```yaml
requires_review:     true
can_execute:         false
can_call_tools:      false
can_bypass_policy:   false
can_bypass_approval: false
```

Absence is treated the same as a wrong value: both produce a `guardrail_violation` issue and the skill is rejected at load time. The TypeScript types use literal `true`/`false` (not `boolean`) so a skill that passes the validator cannot produce a metadata object with incorrect guardrail values.

### INV-SK-3 — Deterministic-first boundary is encoded in the type system

`getTriggerableSkills` and `invokeSkillsForTrigger` accept a `TriggerReason` discriminated union, not a plain string. The caller must state why skills are being consulted (interpretation / workflow_generation / recovery) and only skills of that kind are returned. There is no fallback across kinds — the invocation helper does not decide which kind to use.

### INV-SK-4 — Failures are isolated and auditable

- A broken SKILL.md does not prevent valid skills from loading (partial failure guarantee in loader)
- Each rejected skill produces a `SkillRejection` record with `stage` ('parser' | 'validator') and all structured issues
- All issues are collected in one pass (never fail-fast) so the full problem surface is visible
- Adapter failures (throw, null return, schema mismatch) are caught per-skill; they do not abort sibling invocations
- `rawOutput` is always preserved in `SkillInvocationResult`, even on rejection, for full traceability

### INV-SK-5 — The removal invariant (most important)

**Removing all skills must leave UseSteady behaviorally identical.**

Verified by `tests/skills/skills.test.ts` → `removal test` group:

- `scanSkillsDirectory` on an empty directory returns a clean empty registry, no errors
- `invokeSkillsForTrigger` returns `results: [], accepted: []` with an empty registry
- `buildAuditRecords` on an empty invoke result returns `[]`
- All registry query functions return empty arrays, never throw
- The deterministic intent parser has zero import coupling to the skills system
- `shouldConsultSkills` returns `false` cleanly for all three kinds when the registry is empty

**This invariant must pass after every change to any skills file.**

---

## Allowed and prohibited integration points

### Allowed (next integration slice)

| Integration point | Mechanism | Constraint |
|---|---|---|
| After deterministic parser returns `null` | Call `invokeSkillsForTrigger` with `kind: 'interpretation'` | Only when `shouldConsultSkills` is true; deterministic parse must have been attempted first |
| Explicit broad-request path | Call with `kind: 'workflow_generation'` | Only when caller has explicitly classified the request as broad |
| After `unsupported` / `blocked` / `failed` outcome | Call with `kind: 'recovery'` | Only at recovery decision points; never during active execution |

### Prohibited (frozen boundaries)

| Action | Reason |
|---|---|
| Skills calling the executor directly | Violates zero-authority rule |
| Skills bypassing the approval gate | `can_bypass_approval: false` is compile-time enforced |
| Skills modifying session state | Skills have no access to session or coordinator |
| Auto-selecting a trigger kind | Caller must provide `TriggerReason`; registry does not infer it |
| Falling back across kinds on null result | `invokeSkillsForTrigger` does not auto-retry with a different kind |
| Installing a skill without the 5 required body sections | Validator rejects at load time; not a runtime decision |
| Expanding SKILL.md YAML schema without updating `validator.ts` | Would silently ignore new guardrail fields |

---

## File inventory

### Implementation layers

```
src/skills/
  types.ts        — all types, interfaces, error classes, KIND_SCHEMA_MAP, TriggerReason
  parser.ts       — SKILL.md reader, zero-dep YAML parser, level-aware section extractor
  validator.ts    — full-pass validator, guardrail checks, kind/schema enforcement
  loader.ts       — recursive scan, partial failure, deterministic sort, SkillRejection
  registry.ts     — getSkillsByKind, getTriggerableSkills, shouldConsultSkills, stats
  invocation.ts   — invokeSkillsForTrigger, SkillModelAdapter, SkillInvocationResult
  audit.ts        — buildAuditRecord, buildAuditRecords, AuditSink, NULL/CONSOLE sinks
```

### Starter skill definitions

```
skills/
  filesystem-basic/SKILL.md      — kind: interpretation, priority: 100
  workflow-draft-basic/SKILL.md  — kind: workflow_generation, priority: 100
  recovery-basic/SKILL.md        — kind: recovery, priority: 100
```

### Tests

```
tests/skills/skills.test.ts  — 50 tests across 7 describe groups
```

### Smoke scripts (not part of test suite, run manually after changes)

```
scripts/smoke-invocation.ts  — 32 checks (parser → invocation pipeline)
scripts/smoke-audit.ts       — 25 checks (audit record builder + sinks)
```

---

## Test coverage summary

| Group | Tests | What is proved |
|---|---|---|
| parser | 7 | Frontmatter extraction, YAML errors, BOM, level-aware subheading containment, FILE_NOT_FOUND |
| validator | 10 | Guardrail enforcement, kind/schema mapping, full-pass aggregation, priority default |
| loader | 6 | Real skills dir load, partial failure guarantee, deterministic order stability |
| registry | 5 | Kind isolation, TriggerReason routing, shouldConsultSkills edge cases |
| invocation | 6 | Accepted/null/throw/schema-mismatch paths, provenance on all results, rawOutput preservation |
| audit | 9 | Physical field absence (exactOptionalPropertyTypes), batch timestamp, sourcePaths map, CONSOLE sink JSON format |
| removal test | 7 | Empty registry clean state, empty invoke result, independence from intent parser, no throws |
| **total** | **50** | |

---

## E2E validation state at freeze

### Unit tests

```
2934 passed — 67 files
4 pre-existing failures (claude) — @anthropic-ai/sdk not installed, unchanged
```

### Smoke scripts

```
smoke-invocation: 32 passed, 0 failed
smoke-audit:      25 passed, 0 failed
```

### Simulation

```
102 inputs — 76 recognised · 26 correctly null · 0 FN · 0 FP · 10 documented gaps
```

### Browser spot-checks (5 cases, April 2026)

| Case | Input | Result |
|---|---|---|
| P1 (polite) | `please create folder utils` | PASS — `Create directory: ./utils` |
| C1 (CLI) | `mkdir test` | PASS — `Create directory: ./test` |
| A1 (article noise) | `rename the file old.ts to new.ts` | PASS — `Rename path: old.ts → new.ts` |
| X1 (ambiguous) | `make a folder for components` | PASS — step did not execute, explicit message |
| G1 (safety) | `delete everything` | PASS — step did not execute, no fake path |

---

## What is NOT included in Skills v1

These are intentionally deferred:

- **Real LLM adapter** — `SkillModelAdapter` interface exists; no concrete LLM implementation
- **Skill hot-reload** — skills are loaded once at server start; file-watch is not v1 scope
- **Skill priority conflicts** — single starter skill per kind; priority tie-breaking tested but not exercised by real competing skills
- **User-defined skills** — `skills/` directory is operator-managed; no in-app skill editor
- **Cross-skill output merging** — multiple skills per kind can be invoked; merging their outputs is caller responsibility
- **Skill versioning / migration** — version field is validated as semver; no upgrade path logic

---

## Approved next step

Wire the three starter skills into the existing unsupported / broad-request / recovery paths:

1. After deterministic parser returns `null` — consult `filesystem-basic` (interpretation)
2. After explicit broad-request classification — consult `workflow-draft-basic` (workflow_generation)
3. After `unsupported` or `failed` outcome — consult `recovery-basic` (recovery)

**Constraints for that integration slice:**

- Deterministic parsing must run first and return `null` before interpretation skills are consulted
- `shouldConsultSkills` must be true before calling `invokeSkillsForTrigger`
- Skill output must flow through the existing `SYSTEM WILL` validation path — not bypass it
- Skill suggestions must be presented as candidates, not as confirmed operations
- All four E2E layers must pass after integration (unit → smoke → simulation → browser)

**Surface distinction — locked before integration work begins:**

| Surface label | Source | Trust level |
|---|---|---|
| `SYSTEM WILL` | Deterministic parser produced a confirmed, executable operation | Approved and executable as-is |
| `SYSTEM SUGGESTS` | Skill output — a candidate that passed schema validation but has not been confirmed deterministically | Requires explicit user selection before promotion to `SYSTEM WILL` |

`SYSTEM SUGGESTS` must remain visually and semantically distinct from `SYSTEM WILL` at every integration point. A skill candidate that has not been confirmed through the deterministic validation path must never appear as `SYSTEM WILL`. Collapsing the distinction would let users approve unconfirmed operations, which violates the core product promise ("Never runs a step without your approval" requires the step to be fully understood first).

**Do not expand Skills behavior outside this slice without a named Skills phase.**
