# Phase 11D Baseline — UI Design Follow-Through

**Date:** Phase 11D (post-11C.1)
**Scope:** Three structural friction fixes from the Phase 11A brief (F3, F5, F9).
**Test count at freeze:** 2737 passing / 4 known pre-existing failures (all `@anthropic-ai/sdk` related)

---

## What Changed

### F3 — Pre-flight task list (`reviewing` phase)

`createWorkflowRun(spec)` now returns a run in `"reviewing"` phase instead of `"idle"`.

H must explicitly confirm the pre-flight task list before any session is created.

**New coordinator functions:**

| Function | Valid from | Effect |
|---|---|---|
| `startWorkflow(run, ...policies)` | `"reviewing"` | Transitions to `"idle"`, calls `advanceWorkflow` → `task_ready` / `task_conflict` / `completed` |
| `cancelWorkflow(run)` | `"reviewing"` | Transitions directly to `"stopped"` — no session ever created |

**`advanceWorkflow` is unchanged:** it guards against `"reviewing"` (only valid from `"idle"` or `"running"`). `startWorkflow` is the only path out.

**Shell wiring:** `advanceWorkflowOnConfirm(run, yes, ...)` now handles `"reviewing"`:
- `yes = true` → calls `startWorkflow` → first task prepared
- `yes = false` → calls `cancelWorkflow` → `"stopped"`

**Render:** `renderWorkflowFrame(reviewing)` returns:
- Workflow name and task count in header
- Numbered task list with `[runtime]` and label/input per task
- Confirm prompt: `"Start workflow? (y/n)"`

**CLI loop:** The initial `advanceWorkflow` call after `createWorkflowRun` was removed from `runWorkflowLoop`. The existing generic loop's `confirm` dispatch handles reviewing naturally.

---

### F5 — Approval frame anchored to raw task input

`task_ready` and `task_conflict` frames now show both:

1. `You asked:  <spec.input>` — exact, user-authored input (WF-A1)
2. `Understood: <changeSummary>` — interpreted summary from intake (WF-A2, assistive only)

Raw input appears **first**. Interpreted summary appears second. Both are always shown.

The label `Summary:` in `sessionDetailLines` was renamed to `Understood:` for semantic clarity.

**No authority change.** This is display only.

---

### F9 — `targetFiles` eliminates unnecessary scope prompts

`WorkflowTaskSpec` gained a new optional field:

```typescript
readonly targetFiles?: readonly string[];
```

**Semantics:**
- WF-S1: explicit user scope always wins over inferred scope
- WF-S2: `targetFiles` may only narrow scope — never widen
- WF-S3: if present and delivery returns `scope_question`, scope is auto-resolved without prompting H

**Delivery behavior** (in `deliverWorkflowTask`):

When delivery returns `scope_question` AND `taskSpec.targetFiles` is present:

1. Find the first `targetFiles` entry that appears in the `scopeQuestion.candidates`
2. If match found: auto-answer scope via `answerScope`/`answerClaudeScope` → re-deliver (recursive call within `deliverWorkflowTask`)
3. If no match: `task_failed` with `"Scope contradiction: targetFiles [...] did not match any delivery candidates [...]."`

If `targetFiles` is absent: `scope_question` surfaces as `task_scope` — unchanged behavior.

**Spec validation** (`loadWorkflowSpecFromFile`):
- `targetFiles` must be a non-empty array of non-empty strings when present
- Absent = valid (no scope pre-specification)

---

## New Invariants

| ID | Statement |
|---|---|
| WF-R1 | `reviewing` is pre-execution only — no session may be created in this phase |
| WF-R2 | `currentSession` must be absent when `phase === "reviewing"` |
| WF-R3 | `startWorkflow` is the only path out of `reviewing` into execution |
| WF-R4 | `renderWorkflowFrame(reviewing)` must show the full numbered task list and a confirm prompt |
| WF-A1 | Approval is anchored to `task.spec.input` — the exact user-authored input |
| WF-A2 | Interpreted summary is assistive, not authoritative — appears after raw input |
| WF-A3 | `approved ≠ accepted` — unchanged and still visible |
| WF-S1 | Explicit user scope (`targetFiles`) always wins over inferred scope |
| WF-S2 | `targetFiles` may only narrow scope — contradiction is surfaced, not silently accepted |
| WF-S3 | If `targetFiles` provides sufficient scope, the system must not ask H for scope clarification |

---

## What Did Not Change

- Frozen Cursor V1 and Claude V1 execution seams — **not reopened**
- `confirmWorkflowTask(yes)` approves only — never delivers (**W2 intact**)
- `deliverWorkflowTask` remains the separate explicit delivery step (**W2 intact**)
- Retry creates a new session — never resumes (**W3 intact**)
- Runtime is fixed at spec time — coordinator never derives it (**W8 intact**)
- `advanceWorkflow` authority boundary — unchanged
- Shell render functions — pure (WS1)
- Generic loop branches on `frame.prompt?.kind` only (WS6)
- `task_failed` prompt is always `"choose"`, never `"confirm"` (**WS3 intact**)
- Terminal states are immutable (**P1/W terminal invariants intact**)
- UCP provenance model — unchanged
- History / audit read model — unchanged

---

## Files Created / Updated

### Created

| File | Purpose |
|---|---|
| `tests/workflow/phase-11d.test.ts` | 40 new tests: A (reviewing), B (dual display), C (targetFiles delivery), D (regression) |
| `docs/phase-11d-baseline.md` | This freeze record |

### Updated

| File | Change |
|---|---|
| `src/workflow/types.ts` | Added `"reviewing"` to `WorkflowRunPhase`; added `targetFiles?` to `WorkflowTaskSpec` |
| `src/workflow/coordinator.ts` | `createWorkflowRun` → `"reviewing"`; added `startWorkflow`, `cancelWorkflow`; F9 auto-resolution in `deliverWorkflowTask` |
| `src/workflow/index.ts` | Exported `startWorkflow`, `cancelWorkflow` |
| `src/shell/workflow-render.ts` | Added `"reviewing"` case; F5 `You asked:` / `Understood:` dual structure; renamed `Summary:` → `Understood:` |
| `src/shell/workflow-shell.ts` | `advanceWorkflowOnConfirm` handles `"reviewing"` phase |
| `src/shell/cli/main.ts` | Removed initial `advanceWorkflow` call; added `targetFiles` validation in `loadWorkflowSpecFromFile` |
| `tests/workflow/workflow-coordinator.test.ts` | Updated `advanceToPhase` helper for `reviewing`; updated phase name in two tests |
| `tests/workflow/workflow-persistence.test.ts` | Updated one test regex to match `"reviewing"` instead of `"idle"` |
| `tests/shell/shell-workflow-render.test.ts` | Added `"reviewing"` to phase list; added `reviewing → confirm prompt` test |
| `tests/shell/shell-workflow-shell.test.ts` | Removed pre-emptive `advanceWorkflow` calls from two full-flow tests |
| `tests/shell/shell-workflow-spec.test.ts` | Added 8 `targetFiles` spec-loading tests (Phase 11D / WF-S1 validation) |

---

## Deferred Items

| ID | Description |
|---|---|
| WF-S4 | **Named future invariant (locked guidance):** Spec-level scope contradictions — where `targetFiles` is deterministically incompatible with task input — should be detected before execution when knowable without running intake. Current behavior (fail at delivery when `scope_question` returns no match) is correct and safe. Future behavior (fail at `advanceWorkflow` submit time) is an optimization, not a correctness fix. This invariant is named explicitly to prevent: (a) attempts to "fix" it inside a seam, and (b) partial inference logic being introduced in the coordinator. |
| — | `reviewing` phase in history/audit read model — cancelled workflows produce a `"stopped"` terminal run with zero accepted tasks. The UCP payload and history rendering handle this correctly. No special case needed. |
| — | Batch reviewing (confirm all / reject all tasks at once) — explicitly deferred (W2). |
