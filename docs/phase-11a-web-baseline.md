# Phase 11A-Web Baseline — React UI System Translation

**Date**: 2026-04-04
**Status**: Frozen

---

## What this phase did

Translated the frozen CLI product shell into a React web UI using the identical
architectural contract. The CLI proved the contracts work; the web UI renders
the same contracts without re-inventing any logic.

**Not built**: new seams, new coordinator logic, new authority layers, new
semantics, UI component library dependencies beyond Tailwind.

---

## Architecture rule (locked)

> React is a rendering shell, not a control layer.

The web UI sits in the exact same position as the CLI:

```
Frozen coordinator/session/history APIs
        ↓
Express API bridge (server.ts)
        ↓
HTTP JSON — RunResponse / WorkflowHistorySummary / WorkflowAuditRecord
        ↓
Pure adapters + semantic helpers (browser-safe TypeScript)
        ↓
React components (pure presentational)
        ↓
Page containers (own state + call API client)
```

---

## Files created

### API bridge
| File | Role |
|------|------|
| `server.ts` | Express server wrapping frozen coordinator/history APIs. In-memory run store. Runs on port 3001. |

### React project (`ui/`)
| Path | Role |
|------|------|
| `ui/src/api/types.ts` | Browser-safe DTOs mirroring frozen core types. No Node.js deps. |
| `ui/src/api/client.ts` | Typed HTTP client. All fetch calls here; components never call fetch directly. |
| `ui/src/helpers/interpretation.ts` | `shouldShowInterpretation()`, `extractDualDisplay()` — pure, shared |
| `ui/src/helpers/failure.ts` | `extractFailureExplanation()`, `failureActions()` — pure, shared |
| `ui/src/helpers/task-status.ts` | `taskOutcomeBadge()`, `runPhaseBadge()`, `taskDisplayLabel()` — pure, shared |
| `ui/src/adapters/shell-frame.ts` | `shellFrameToViewModel()` — ShellFrame → structured FrameViewModel |
| `ui/src/adapters/history.ts` | `workflowHistoryToListItem()`, `workflowAuditToDetailView()` |
| `ui/src/components/ui/Badge.tsx` | Base badge with BadgeVariant |
| `ui/src/components/ui/Button.tsx` | Base button with variant/size |
| `ui/src/components/ui/Card.tsx` | Card, CardHeader, CardSection |
| `ui/src/components/ui/LoadingSpinner.tsx` | Spinner + ErrorMessage |
| `ui/src/components/frames/ReviewingFrame.tsx` | Pre-flight task list + start/cancel |
| `ui/src/components/frames/ApprovalFrame.tsx` | You asked / System understood / Approve / Reject |
| `ui/src/components/frames/FailureFrame.tsx` | Failure cause + Retry/Skip/Stop |
| `ui/src/components/frames/ScopeClarificationFrame.tsx` | Candidate radio list + confirm |
| `ui/src/components/frames/TerminalFrame.tsx` | CompletedFrame, StoppedFrame, ApprovedFrame |
| `ui/src/components/workflow/WorkflowHeader.tsx` | Phase badge + workflow name + workspace path |
| `ui/src/components/workflow/WorkflowTaskSidebar.tsx` | Full numbered task list with per-task status |
| `ui/src/components/workflow/WorkflowFramePanel.tsx` | Phase-first dispatch to frame components |
| `ui/src/components/history/HistoryListPane.tsx` | Tier 1 summary cards |
| `ui/src/components/history/TaskAuditList.tsx` | Per-task Tier 2 audit entries |
| `ui/src/components/history/HistoryDetailPane.tsx` | Audit detail pane |
| `ui/src/hooks/useWorkflowRun.ts` | Workflow run state + action dispatch |
| `ui/src/hooks/useWorkflowHistory.ts` | History list + audit record hooks |
| `ui/src/pages/WorkflowPage.tsx` | Application container for live workflow |
| `ui/src/pages/HistoryPage.tsx` | Application container for history/audit |
| `ui/src/App.tsx` | Router + NavBar |
| `ui/src/main.tsx` | React entry point |

---

## API server invariant (locked)

### API-W1 — Transport convenience must not change observable semantics

The server may advance **transient** phases for transport convenience, but must
not change observable workflow semantics.

**Permitted:** collapsing `"running"` (non-observable intermediate state — no
client prompt is associated with it).

**Prohibited:** skipping approval, auto-confirm, hidden retries, or any
transition that requires human input in the frozen shell model.

Operationally: `drainRunning()` in `server.ts` is the only transport-convenience
advance permitted. It is guarded to stop on no-change (preventing infinite
loops) and exits immediately when `run.phase` is any prompt-bearing state
(`task_ready`, `task_conflict`, `task_failed`, `scope_question`, `reviewing`).

This rule prevents future drift where "server convenience" silently becomes
an implicit behavior change.

---

## UI invariants (locked)

### UI-W1 — No reinterpretation
React renders frozen contract outputs; it does not reinterpret them.
`WorkflowFramePanel` reads `run.phase` and `frame.prompt?.kind` only.

### UI-W2 — Controls map to existing actions only
Interactive controls call only:
- `confirmWorkflow(yes)` → `advanceWorkflowOnConfirm`
- `chooseWorkflow(idx)` → `advanceWorkflowOnChoice`
- `startWorkflow(spec)` → `createWorkflowRun`

No new behaviors, no new decisions.

### UI-W3 — No prompt → read-only
`WorkflowFramePanel` renders `CompletedFrame` or `StoppedFrame` (no buttons)
when `isTerminal` is true or `frame.prompt` is absent.

### UI-W4 — History reads persisted records only
`HistoryPage` and its children never receive a live `WorkflowRun` object.
They receive `WorkflowHistorySummary` and `WorkflowAuditRecord` from the API,
which reads only from `storeDir`.

### UI-W5 — Raw input before interpreted summary
`ApprovalFrame` always renders "You asked:" (`spec.input`) first.
"System understood:" is rendered second, only if `shouldShowInterpretation()`
returns true.

### UI-W6 — Hide unhelpful interpretation
`shouldShowInterpretation(input, summary)` returns false when summary is
absent, identical to input, or trivially short. The "System understood:"
section is hidden in that case.

### UI-W7 — Preserve failure cause verbatim
`FailureFrame` renders `extractFailureExplanation(frame.lines).what` without
reformatting. The exact string from the coordinator reaches the user.

---

## Phase-first dispatch rule (mirrors CLI WS6)

`WorkflowFramePanel` branches on `run.phase` first, `frame.prompt?.kind`
second, and never on runtime identity. This is the web equivalent of the CLI's
generic shell loop guarantee.

```typescript
switch (run.phase) {
  case "reviewing":      → ReviewingFrame
  case "task_ready":     → ApprovalFrame (isConflict=false)
  case "task_conflict":  → ApprovalFrame (isConflict=true)
  case "task_failed":    → FailureFrame
  case "scope_question": → ScopeClarificationFrame
  case "task_approved":
  case "running":        → ApprovedFrame (loading indicator)
  case "completed":      → CompletedFrame (read-only)
  case "stopped":        → StoppedFrame (read-only)
}
```

---

## What did not change

- No coordinator logic changed
- No shell advance functions changed
- No session types changed
- No authority moved into React or the API server
- CLI remains fully functional and independent
- All Phase 11D invariants (WF-R1–4, WF-A1–3, WF-S1–4) remain in effect

---

## Running the system

```bash
# Terminal 1: API server (port 3001)
cd C:/usesteady-core-v2
npx tsx server.ts

# Terminal 2: React dev server (port 5173, proxies /api/ to 3001)
cd C:/usesteady-core-v2/ui
npm run dev
```

Open http://localhost:5173

---

---

## Phase 11E — Workflow Builder Entry (locked)

**Rule:** WorkflowBuilder is an authoring surface, not an interpreter.
- Collects strings → assembles `WorkflowSpec`
- Does not validate intent beyond basic field completeness
- Does not preview execution semantics
- Does not auto-rewrite tasks

**Files added/changed:**
- `ui/src/components/workflow/WorkflowBuilder.tsx` — task rows, runtime selector, targetFiles, Save spec
- `ui/src/pages/WorkflowPage.tsx` — Build tab (default) + Load tab; both converge into the same start path

**Entry model change:**
- Build tab: type tasks in natural-language Cursor-prompt style → Start
- Load tab: drop JSON spec (power users, saved/shared workflows)
- Save spec: exports valid reusable `.json` after building

**Invariant:** `onBuild` and the Load confirmation both call `handle.start(spec)` — identical downstream path, zero seam divergence.

---

## Deferred

- Authentication / access control (out of scope for V1)
- Persistent run storage (current store is in-memory; cleared on server restart)
- Workspace root management / project switching UI
- WebSocket / SSE for real-time frame streaming (currently request/response)
- Claude Claude adapter (Claude stub used in API server; real wiring is deferred)
- Mobile layout
