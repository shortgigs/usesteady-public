# Cursor V1 Baseline — Seam + Product Session

**Status**: Locked  
**Test count at freeze**: 2139 tests, 50 files, 0 regressions  
**Governance**: See [`docs/architecture/MODEL_INSERTION_POLICY.md`](./architecture/MODEL_INSERTION_POLICY.md) — the Delivery Gate, OCD, scope selection logic, and UCP persistence are all Section 3.1 Authority Layers. Models are strictly forbidden from influencing any of them.

This document is the formal freeze record for the Cursor seam, execution coordinator,
in-process transport adapter, and product session state machine. It records what is locked,
what the invariants are, and what is explicitly deferred.

Nothing in this document changes until a version increment is justified by new evidence.

---

## What is locked

### Files

| File | Role |
|------|------|
| `src/cursor/types.ts` | All Cursor seam types — artifact, OCD clearance, scope constraint, delivery request/response, error codes |
| `src/cursor/artifact-mapper.ts` | `buildCursorHandoffArtifact`, `narrowArtifactScope`, `approveArtifact` |
| `src/cursor/ocd-evaluator.ts` | `evaluateOCDForHandoff`, `applyOCDClearance`, `acceptOCDConflict`, `validateHProvidedPath` |
| `src/cursor/glob-matcher.ts` | Minimal glob evaluator for OCD policy — tested independently |
| `src/cursor/delivery-gate.ts` | `CursorDeliveryGate`, `CursorEditorPlugin` interface, `DeliveryGateResult` |
| `src/cursor/adapters/inprocess-adapter.ts` | `CursorInProcessAdapter` — real filesystem transport |
| `src/cursor/adapters/stub-adapter.ts` | `CursorStubAdapter` — test-only transport |
| `src/cursor/index.ts` | Public API surface for `src/cursor/` |
| `src/execution/cursor/cursor-execution-coordinator.ts` | `prepareCursorExecution`, `deliverCursorExecution` and all display/result types |
| `src/execution/cursor/index.ts` | Public API surface for `src/execution/cursor/` |
| `src/ucp/types.ts` | Extended with `CursorHandoffPayload`, `CursorReceiptPayload`, `CursorRefusedPayload` |
| `src/ucp/envelope.ts` | Extended with `createCursorHandoffEnvelope`, `createCursorReceiptEnvelope`, `createCursorRefusedEnvelope` |
| `src/ucp/persistence/write.ts` | Extended with `persistEnvelopeOrThrow` |
| `src/index.ts` | Cursor types + coordinator re-exported at root API surface |
| `src/product/cursor-product-session.ts` | `CursorProductSession` flat state machine — all transition functions and phase guards |
| `src/product/index.ts` | Public API surface for the product session layer |

### Tests

| File | Coverage |
|------|----------|
| `tests/cursor/cursor-delivery.test.ts` | Delivery gate: eligibility, persistence semantics, OCD evaluator, glob-matcher, `approveArtifact`, `narrowArtifactScope` |
| `tests/cursor/cursor-inprocess-adapter.test.ts` | `CursorInProcessAdapter`: accepted/error/scope paths, real filesystem, e2e with gate |
| `tests/cursor/cursor-execution-coordinator.test.ts` | `prepareCursorExecution`, `deliverCursorExecution`, consumer helpers, full round-trip |
| `tests/product/cursor-product-session.test.ts` | Session invariants S1–S6, all phase gates, terminal state preservation, approve-is-not-deliver |

### Docs

| File | Content |
|------|---------|
| `docs/cursor-integration-architecture.md` | Authority model, artifact shape, state machine, boundary rules, Cursor-side consumption, implementation notes |
| `docs/cursor-delivery-contract.md` | Q1/Q2: delivery request/response shapes, persistence points, delivery paths |
| `docs/cursor-policy-matrix.md` | State transitions, H visibility, re-confirmation triggers, terminal vs retryable states |
| `docs/cursor-allowedfiles-policy.md` | Q3: `allowedFiles` population hierarchy, OCD constrain-only rule, H-provided path validation |
| `docs/cursor-v1-baseline.md` | This document — formal freeze record for seam + product session |

---

## Product session baseline truths (locked)

These six truths are the permanent behavioral contract of the product session layer.
They are enforced in code, tested in `tests/product/cursor-product-session.test.ts`,
and annotated in `src/product/cursor-product-session.ts`.

**P1 — Terminal states are immutable.**  
Once a session reaches any terminal phase (`accepted`, `rejected`, `exec_error`,
`blocked`, `not_execute`, `intake_failed`), all further transition calls return the
same state object unchanged. No phase change is possible. A new session must be
created for a new edit attempt.  
Consequence: there is no "undo" at the session level. History belongs to a higher layer.

**P2 — Scope clarification is candidate-bounded.**  
`answerScope(state, file)` rejects any `file` not present in
`state.scopeQuestion.candidates`. Cursor returned exactly those candidates from its
search within the approved scope. Selecting outside them is silent scope expansion —
the system blocks it rather than allowing it.

**P3 — Approval is never execution.**  
`approve()` transitions to `"approved"`. `deliver()` is a separate, explicit call
by the product shell. The word "accepted" (post-delivery outcome) and the word
"approved" (human authorization) describe two different things and must never be
collapsed into one call, one state, or one display label.

**P4 — Delivery requires approved.**  
`deliver()` called from any phase other than `"approved"` transitions to `"blocked"`.
The delivery gate inside `deliverCursorExecution()` independently checks artifact
eligibility. Both guards exist: the session-level guard prevents accidental calls;
the gate-level guard is the authoritative enforcement point.

**P5 — Session carries state but has no independent authority.**  
The session holds the artifact, provenance IDs, and display fields between steps.
It does not produce intent, does not evaluate policy, does not approve artifacts,
and does not decide eligibility. It is a state carrier and transition guard.

**P6 — All authority lives upstream of the session.**  

```
intake  → sole mode authority (execute / guide / clarify / refuse / ignore)
OCD     → sole policy authority (conflicts, prohibited patterns, safe globs)
H       → sole approval authority (approve, narrow, acceptConflict, answerScope)
gate    → sole delivery eligibility authority (eligibility check + UCP persistence)
Session → no authority of its own
```

No session function may substitute for any of these.
The session calls them; it does not replace them.

---

## Product session invariants (implementation-level)

These are the six session-layer truths enforced by `cursor-product-session.ts` and
verified by `tests/product/cursor-product-session.test.ts`.

**S1 — submit() on non-execute never creates an artifact.**  
When `intakeResult.mode !== "execute"`, the session transitions to `"not_execute"` with
no `artifact` field. No OCD evaluation, no artifact construction, no side effects.  
Violation: an artifact present in a non-execute session would imply silent scope creation.

**S2 — approve() cannot run from conflict without explicit acceptConflict().**  
`approve()` only advances from `"prepared"`. Calling it from `"conflict"` produces
`"blocked"` via `invalidTransition()`. The required path is:  
`"conflict"` → `acceptConflict()` → `"prepared"` → `approve()` → `"approved"`.  
Violation: bypassing conflict acceptance would silently ignore OCD policy conflicts.

**S3 — narrow() is monotonic.**  
`narrow(state, files)` passes `files` exactly to `narrowArtifactScope()` — nothing is
added. Monotonic enforcement (subset-only) is the responsibility of `narrowArtifactScope`
(tested in `cursor-delivery.test.ts`). The session never widens the call.  
Violation: passing additional files would silently expand approved scope.

**S4 — answerScope() must only choose from candidates.**  
`answerScope(state, file)` checks that `file` is present in
`state.scopeQuestion.candidates` before calling `narrowArtifactScope`. A non-candidate
file produces `"blocked"`. Cursor surfaced exactly those candidates; any other file
was not searched and is not a valid choice.  
Violation: choosing outside candidates would silently cross into unsearched scope.

**S5 — accepted is terminal for that session.**  
Once `phase === "accepted"`, all transition functions return the same state object
unchanged. No further phase change is possible. A new session must be created for a
new edit attempt.  
Violation: transitioning out of accepted would allow double-application or authority confusion.

**S6 — rejected is terminal for that session.**  
Once `phase === "rejected"`, all transition functions return the same state object
unchanged. H's rejection is final for that session lifecycle.  
Violation: transitioning out of rejected would override an explicit human decision.

**S7 — approve() is not auto-deliver.**  
`approve()` transitions to `"approved"`, not `"accepted"`. The `deliver()` call is a
separate explicit act by the product shell. The state machine does not automatically
proceed to filesystem mutation after approval.  
This keeps the session reusable for any product shell (CLI, UI, plugin) that may need
to interpose between approval and delivery.

**S8 — deliver() requires "approved" phase.**  
`deliver()` called from any phase other than `"approved"` returns `"blocked"` via
`invalidTransition()`. The gate inside `deliverCursorExecution()` also independently
checks `eligibility === "approved_for_cursor"`. Defense-in-depth.

---

## Seam invariants (implementation-level)

These are truths enforced by the code, not conventions.

**I1 — prepareCursorExecution() is side-effect-free.**  
No files are read or written during preparation. The filesystem is not touched.  
Violation would mean file reads or writes before H approval.

**I2 — deliverCursorExecution() requires approved artifact.**  
`eligibility !== "approved_for_cursor"` → `blocked_ineligible`. The check runs in the
delivery gate, outside Cursor's process. Cursor cannot observe or bypass it.

**I3 — parsedChange is coordinator-owned, not interpretation-owned.**  
`InterpretationResult` carries `{ summary, impact, confidence, category }` only.  
`ParsedChange` is passed separately by the coordinator from `parseChange(input)`.  
This keeps the interpreter from becoming an implicit edit-spec carrier.

**I4 — approveArtifact() is the only approval transition.**  
No other function sets `eligibility = "approved_for_cursor"`.  
The function is exported and testable. It does not involve OCD, Present, or Cursor.

**I5 — File mutation happens only after gate success.**  
The in-process adapter writes to disk only on `CursorAccepted`.  
On any refusal or error path, the filesystem is unchanged.  
This is tested explicitly in `cursor-inprocess-adapter.test.ts`.

**I6 — Exactly one match required for accepted replacement.**  
`ambiguous_match` is a first-class error when `oldValue` appears more than once.  
There is no silent multi-replace. The adapter uses `indexOf` (not regex).

**I7 — Scope refusal is recoverable only through H narrowing.**  
`CursorRefusedDueToScope` → H narrows `allowedFiles` → `narrowArtifactScope` → H re-confirms → retry.  
The system does not automatically choose a file. That decision belongs to H.

**I8 — ucp.cursor_handoff.v1 persists before send, or delivery is blocked.**  
`persistEnvelopeOrThrow` throws on disk failure. The gate catches it and returns
`blocked_persistence_failure`. Cursor never receives the artifact without a trace record.

**I9 — Raw input never crosses the seam.**  
`CursorHandoffArtifact` does not contain the original input string.  
Cursor cannot re-derive intent from what it never sees.

**I10 — OCD constrains only; it never proposes allowedFiles.**  
Only `parsedChange.filePath` (from the coordinator) or H (explicit narrowing) propose allowed files.  
OCD fires conflicts and adds `prohibitedPatterns`. It does not select targets.

---

## Authority model (frozen)

```
Intake      → produces mode (sole authority), ParsedChange, InterpretationResult
OCD         → evaluates policy, surfaces conflicts, adds prohibitedPatterns
Coordinator → builds artifact, threads parsedChange, surfaces OCD result to H
Session     → state machine connecting engine to H interaction; holds no authority
H           → sole approval authority; may narrow scope; must explicitly accept conflicts
Gate        → checks eligibility, persists handoff envelope, passes to transport
Cursor      → executes within approved scope; cannot reinterpret, expand, or re-confirm
```

No layer exercises authority that belongs to another layer.  
The session is a state carrier and transition guard — it calls authority; it does not hold it.  
The delivery gate is the enforcement point between H and Cursor.

---

## What is NOT locked (explicitly deferred)

| Item | Reason deferred |
|------|----------------|
| `ucp.cursor_artifact.v1` | Reserved slot between `cursor_receipt` and `execution_trace`. Introduced when Cursor produces a real diff object. |
| `getTimeline` cursor fields (`cursorHandoff`, `cursorReceipt`, `cursorRefused`) | Requires UCPBundle ownership review (Q5). |
| Concurrent edit / merge conflict handling (Q4) | Requires replay integration. |
| H confirmation timeout value (Q6) | Policy matrix design work. |
| IPC or remote transport adapter | In-process adapter proves the contract. IPC follows the same `CursorEditorPlugin` interface when needed. |
| Multi-session sequencing | One session = one edit attempt. Sequencing (undo, re-run, history) is downstream. |
| UI shell around session | CLI demo proves the wiring. A real UI shell consumes the session API as-is. |

---

## Consumer call sequence (V1 canonical)

### Via product session (recommended)

```typescript
import { createSession, submit, approve, deliver, isTerminal }
  from "./src/product/index.js";

let session = createSession();

// 1. Submit user input — runs intake + prepare internally
session = submit(session, userInput, policy);
// session.phase: "prepared" | "conflict" | "not_execute" | "intake_failed"
// session.display: { headline, changeSummary, targetFiles, conflicts }

// 2. Surface session.display to H

// 3a. If conflict — H must accept before approving
if (session.phase === "conflict") {
  session = acceptConflict(session);  // or reject(session)
}

// 3b. H approves (only valid from "prepared")
session = approve(session);

// 4. Deliver — explicit separate act by the shell
session = await deliver(session, plugin, storeDir);
// session.phase: "accepted" | "scope_question" | "exec_error" | "blocked"

// 5. If scope question — H selects from candidates
if (session.phase === "scope_question") {
  session = answerScope(session, selectedFile);  // must be from candidates
  session = await deliver(session, plugin, storeDir);
}
```

### Via coordinator directly (lower-level)

```typescript
// 1. Run intake
const { result: intakeResult, ucp } = runIntakeWithUCP(input);
if (intakeResult.mode !== "execute") return;

// 2. Parse change (if structured command)
const pc = parseChange(input) ?? undefined;

// 3. Prepare — synchronous, no side effects
const prep = prepareCursorExecution(
  intakeResult, ucp.intent.id, ucp.response.id, policy, pc,
);
// prep.kind: "ready_for_confirmation" | "conflict_detected" | "not_execute"

// 4. Surface to H — H may narrow, acceptConflict, or reject

// 5. H approves
const approved = approveArtifact(prep.artifact, Date.now());

// 6. Deliver — async, real file mutation
const result = await deliverCursorExecution(approved, plugin, storeDir);
// result.kind: "accepted" | "refused_due_to_scope" | "refused_due_to_execution_error" | "blocked_*"
```

---

## Key design decisions (rationale)

**Why two phases?**  
Preparation must be explainable to H before anything touches the filesystem.  
A single async call would conflate "what will happen" with "making it happen."  
The split enforces explain-before-modify at the architectural level.

**Why is parsedChange at the coordinator level?**  
`InterpretationResult` is the "what does this change mean" structure. It is advisory.  
`ParsedChange` is the "what exactly to replace" structure. It is an edit directive.  
Conflating them would make the interpreter an implicit execution authority.  
The coordinator is the right place because it holds both and knows the flow context.

**Why is scope refusal not automatically resolved?**  
Automatic file selection is a silent scope expansion.  
The system does not have permission to decide which file H intended.  
H must select. The architecture enforces this by making `CursorRefusedDueToScope`  
the response and requiring H to call `narrowArtifactScope()` before re-confirming.

**Why is `ambiguous_match` a first-class error?**  
Silent multi-replace is a silent scope expansion in the edit dimension.  
If `oldValue` appears three times, applying to all three is three times the approved scope.  
Exact single-match is the only safe interpretation of "replace X with Y."
