# Claude V1 Baseline — Seam + Real Adapter + Product Session

**Status**: Locked  
**Test count at freeze**: 2501 tests, 57 files, 0 regressions  
**Build phases**: 8A (architecture), 8B (scaffold), 8C (real adapter + product session)  
**Governance**: See [`docs/architecture/MODEL_INSERTION_POLICY.md`](./architecture/MODEL_INSERTION_POLICY.md) — Claude Managed Agents is an *execution runtime*, not a model advisory layer. The delivery gate, tool policy, scope selection, OCD evaluation, and UCP persistence are all Section 3.1 Authority Layers. Models are strictly forbidden from influencing any of them. Claude's task execution is downstream of human approval, not a control decision.

This document is the formal freeze record for the Claude Managed Agents seam, execution
coordinator, real Anthropic API adapter, and product session state machine. It records
what is locked, what the invariants are, and what is explicitly deferred.

Nothing in this document changes until a version increment is justified by new evidence.

---

## What is locked

### Files

| File | Role |
|------|------|
| `src/claude/types.ts` | All Claude seam types — artifact, tool policy, eligibility, delivery request/response, scope question |
| `src/claude/artifact-mapper.ts` | `buildClaudeHandoffArtifact`, `approveClaudeArtifact`, `narrowClaudeArtifactScope` |
| `src/claude/delivery-gate.ts` | `ClaudeDeliveryGate`, `ClaudeAgentPlugin` interface, `ClaudeDeliveryGateResult` |
| `src/claude/adapters/stub-adapter.ts` | `ClaudeStubAdapter` — test-only transport |
| `src/claude/adapters/api-adapter.ts` | `ClaudeApiAdapter` — real Anthropic API transport (Phase 8C) |
| `src/claude/index.ts` | Public API surface for `src/claude/` |
| `src/execution/claude/claude-execution-coordinator.ts` | `prepareClaudeExecution`, `deliverClaudeExecution` and all display/result types |
| `src/execution/claude/index.ts` | Public API surface for `src/execution/claude/` |
| `src/product/claude-product-session.ts` | `ClaudeProductSession` flat state machine — all transition functions and phase guards |
| `src/product/index.ts` | Extended with Claude product session public API |
| `src/ucp/types.ts` | Extended with `ClaudeHandoffPayload`, `ClaudeReceiptPayload`, `ClaudeRefusedPayload` |
| `src/ucp/envelope.ts` | Extended with `createClaudeHandoffEnvelope`, `createClaudeReceiptEnvelope`, `createClaudeRefusedEnvelope` |

### Tests

| File | Coverage |
|------|----------|
| `tests/claude/claude-delivery.test.ts` | Delivery gate: eligibility, tool policy enforcement (A2), persistence semantics, stub adapter, UCP envelope chain, Phase A locked truths (A1–A4) |
| `tests/claude/claude-api-adapter.test.ts` | `ClaudeApiAdapter`: model insertion policy bypass, prompt construction invariants, tool resolution, response mapping (all three paths), error mapping, gate integration |
| `tests/product/claude-product-session.test.ts` | Session invariants S1–S6, all phase gates, terminal state preservation, approve-is-not-deliver, UCP provenance, handoff-before-plugin ordering |

### Docs

| File | Content |
|------|---------|
| `docs/claude-agent-phase-a-architecture.md` | Phase A freeze: authority model, artifact shape, delivery contract, state machine, UCP chain, Phase B entry conditions |
| `docs/claude-v1-baseline.md` | This document — formal freeze record for the complete Claude V1 seam + product session |

---

## Phase A architecture truths (A1–A4)

These four truths were locked in Phase 8A and remain unchanged through 8B and 8C.
They are enforced in `src/claude/types.ts`, `src/claude/delivery-gate.ts`,
`src/claude/adapters/api-adapter.ts`, and verified in `tests/claude/claude-delivery.test.ts`.

**A1 — executionDomain is mapper-derived, never reclassified downstream.**  
`buildClaudeHandoffArtifact()` is the single derivation point for `executionDomain`.  
No downstream layer (coordinator, session, gate, adapter) may re-classify it.  
The delivery gate validates presence and allowed values only.  
Consequence: Claude never receives a different task classification than what the
artifact mapper derived from the interpretation result.

**A2 — networkAccess: "allow_limited" is reserved and V1-blocked.**  
`"deny"` is the only executable value for `toolPolicy.networkAccess` in V1.  
The delivery gate hard-rejects any artifact where `networkAccess !== "deny"`.  
`"allow_limited"` is defined in the type for forward compatibility but blocked at the gate.  
The `ClaudeApiAdapter` also enforces this at the system prompt level (network access denied).  
Consequence: Claude's tools cannot make external HTTP requests in V1.

**A3 — Interrupted Claude sessions are non-resumable in V1.**  
A connection error, timeout, or API interruption maps to
`refused_due_to_execution_error` with code `"session_interrupted"`.  
There is no resume path, no session ID re-use, no retry within the same delivery.  
The product session transitions to `"exec_error"` (terminal).  
A new session must be created for retry.

**A4 — No callback loop from Claude to Intake exists in V1.**  
The only mid-flight feedback path is structured scope clarification via
`ClaudeScopeQuestion`, which is mediated by H through `answerClaudeScope()`.  
Claude cannot re-query intake, re-classify intent, or modify the artifact contract.

---

## Product session baseline truths (P1–P6)

These six truths are the permanent behavioral contract of the product session layer.
They are enforced in `src/product/claude-product-session.ts` and verified in
`tests/product/claude-product-session.test.ts`.

**P1 — Terminal states are immutable.**  
Once a session reaches any terminal phase (`accepted`, `rejected`, `exec_error`,
`blocked`, `not_execute`, `intake_failed`), all further transition calls return the
same state object unchanged. No phase change is possible. A new session must be
created for a new attempt.  
Consequence: there is no "undo" at the session level.

**P2 — Scope clarification is candidate-bounded.**  
`answerClaudeScope(state, file)` rejects any `file` not present in
`state.scopeQuestion.candidates`. Claude returned exactly those candidates from its
search within the approved artifact scope. Selecting outside them is silent scope
expansion — the system blocks it rather than allowing it.

**P3 — Approval is never execution.**  
`approveClaude()` transitions to `"approved"`. `deliverClaude()` is a separate,
explicit call by the product shell. "accepted" (post-delivery outcome) and "approved"
(human authorization) describe different things and must never be collapsed into one
call, one state, or one display label.

**P4 — Delivery requires approved.**  
`deliverClaude()` called from any phase other than `"approved"` transitions to
`"blocked"`. The delivery gate independently checks `eligibility === "approved_for_agent"`.
Both guards exist: session-level prevents accidental calls; gate-level is the
authoritative enforcement point.

**P5 — Session carries state but has no independent authority.**  
The session holds the artifact, provenance IDs, and display fields between steps.  
It does not produce intent, does not evaluate policy, does not approve artifacts,
and does not decide eligibility. It is a state carrier and transition guard.

**P6 — All authority lives upstream of the session.**

```
intake  → sole mode authority (execute / guide / clarify / refuse / ignore)
OCD     → sole policy authority (conflicts, prohibited patterns)
H       → sole approval authority (approve, narrow, acceptConflict, answerScope)
gate    → sole delivery eligibility authority (eligibility check + UCP persistence)
Session → no authority of its own
```

No session function may substitute for any of these.  
The session calls them; it does not replace them.

---

## Session invariants (S1–S8)

These are the session-layer truths enforced by `claude-product-session.ts` and
verified by `tests/product/claude-product-session.test.ts`.

**S1 — submitClaude() on non-execute never creates an artifact.**  
When `intakeResult.mode !== "execute"`, the session transitions to `"not_execute"` with
no `artifact` field. No OCD evaluation, no artifact construction, no side effects.

**S2 — approveClaude() cannot run from conflict without explicit acceptClaudeConflict().**  
`approveClaude()` only advances from `"prepared"`. Calling it from `"conflict"` produces
`"blocked"`. The required path is:  
`"conflict"` → `acceptClaudeConflict()` → `"prepared"` → `approveClaude()` → `"approved"`.

**S3 — narrowClaude() is monotonic.**  
`narrowClaude(state, files)` passes `files` exactly to `narrowClaudeArtifactScope()` —
nothing is added. The session never widens the call.

**S4 — answerClaudeScope() must only choose from candidates.**  
`answerClaudeScope(state, file)` checks that `file` is present in
`state.scopeQuestion.candidates` before narrowing. A non-candidate file produces
`"blocked"`. Claude surfaced exactly those candidates; any other file was not searched.

**S5 — accepted is terminal for that session.**  
Once `phase === "accepted"`, all transition functions return the same state object
unchanged. A new session must be created for a new attempt.

**S6 — rejected is terminal for that session.**  
Once `phase === "rejected"`, all transition functions return the same state object
unchanged. H's rejection is final for that session lifecycle.

**S7 — approveClaude() is not auto-deliver.**  
`approveClaude()` transitions to `"approved"`, not `"accepted"`. The `deliverClaude()`
call is a separate explicit act by the product shell.

**S8 — deliverClaude() requires "approved" phase.**  
Called from any phase other than `"approved"` returns `"blocked"` via `invalidClaudeTransition()`.
The gate also independently checks `eligibility === "approved_for_agent"`. Defense-in-depth.

---

## Seam invariants (I1–I9)

These are truths enforced by the code, not conventions.

**I1 — prepareClaudeExecution() is side-effect-free.**  
No API calls are made during preparation. No files are read or written.  
The function is synchronous and deterministic.

**I2 — deliverClaudeExecution() requires approved artifact.**  
`eligibility !== "approved_for_agent"` → `blocked_ineligible`. The check runs in
the delivery gate, independently of the session-layer guard.

**I3 — executionDomain is derived once (A1).**  
`buildClaudeHandoffArtifact()` is the single derivation point. The coordinator,
session, gate, and adapter consume it — they never re-derive it.

**I4 — approveClaudeArtifact() is the only approval transition.**  
No other function sets `eligibility = "approved_for_agent"`.  
`narrowClaudeArtifactScope()` explicitly resets to `"pending_confirmation"`.

**I5 — ucp.claude_handoff.v1 persists before Claude is called.**  
`persistEnvelopeOrThrow` throws on failure. The gate catches it and returns
`blocked_persistence_failure`. Claude never receives the artifact without a trace record.

**I6 — Raw input never crosses the seam.**  
`ClaudeAgentHandoffArtifact` does not contain the original input string.  
`ClaudeApiAdapter` builds its prompt from `artifact.taskSpec` only (A4).  
Claude cannot re-derive intent from what it never sees.

**I7 — OCD constrains only; it never proposes allowedFiles.**  
Only `parsedChange.filePath` (from the coordinator) or H (explicit narrowing) propose
allowed files. OCD fires conflicts and embeds `prohibitedPatterns`. It does not select targets.

**I8 — Scope refusal is recoverable only through H narrowing.**  
`ClaudeRefusedDueToScope` → H calls `answerClaudeScope(file)` → file must be from
`scopeQuestion.candidates` → `narrowClaudeArtifactScope` → H re-approves → retry.  
The system does not automatically choose a file. That decision belongs to H.

**I9 — Tool prompt construction is taskSpec-only (A4).**  
`ClaudeApiAdapter.buildSystemPrompt()` and `buildUserMessage()` consume only
`artifact.taskSpec`, `artifact.allowedFiles`, `artifact.prohibitedPatterns`,
`artifact.allowedTools`, and `artifact.executionDomain`. No other upstream state is read.

---

## Real adapter truths (ClaudeApiAdapter — Phase 8C)

**RA1 — Prompt source is taskSpec only.**  
System prompt: derived from artifact constraint fields.  
User message: derived from `taskSpec.summary`, `taskSpec.category`, `taskSpec.parsedChange`.  
Neither contains the original user input string.

**RA2 — Tool registry is closed.**  
V1 known tools: `str_replace_editor`, `read_file`, `list_files`, `run_tests`.  
`request_scope_clarification` is always included as a gate protocol tool.  
Unknown tool names are silently skipped. No dynamic tool discovery.

**RA3 — Response mapping is closed (fail-closed).**  
`end_turn` or `max_tokens` → `accepted` (sessionId = API response `.id`).  
`tool_use` + `request_scope_clarification` → `refused_due_to_scope`.  
`tool_use` + any task tool → `accepted` (Claude used a tool; session is live).  
`stop_sequence` or unknown stop reason → `refused_due_to_execution_error`.  
Any thrown value → `refused_due_to_execution_error`.

**RA4 — Candidate normalization filters to allowedFiles subset.**  
When Claude returns scope candidates and `allowedFiles` is non-empty, candidates are
filtered to the intersection. If no intersection: all candidates pass through for H.

**RA5 — Model Insertion Policy: deterministic bypass path required.**  
`USESTEADY_USE_CLAUDE !== "true"` + `config.bypass` provided → bypass plugin is used.  
In CI: callers inject `ClaudeStubAdapter` as bypass. No real API calls in automated tests.

**RA6 — Connection errors map to session_interrupted (A3).**  
`APIConnectionError` and `APIConnectionTimeoutError` → `session_interrupted`.  
Non-resumable. Product session transitions to `"exec_error"` (terminal).

---

## Authority model (frozen)

```
Intake       → produces mode (sole authority), ParsedChange, InterpretationResult
OCD policy   → embeds prohibitedPatterns in artifact; fires conflicts via coordinator
Coordinator  → builds artifact, threads parsedChange, surfaces OCD result to H
Session      → state machine connecting engine to H interaction; holds no authority
H            → sole approval authority; may narrow scope; must explicitly accept conflicts
Gate         → checks eligibility + tool policy; persists handoff envelope; passes to transport
Adapter      → translates approved artifact to API call; no authority to re-derive or expand
Claude       → executes within approved scope; cannot reinterpret, expand, or callback to Intake
```

No layer exercises authority that belongs to another layer.  
The delivery gate is the enforcement point between H and Claude.  
Claude is an execution runtime. It is not an advisory or control layer.

---

## What is NOT built (explicitly deferred)

| Item | Reason deferred |
|------|----------------|
| `ucp.claude_session.v1` | Reserved for managed session event history. Not needed until session-level observability is required. |
| `ucp.claude_result.v1` | Reserved slot between `claude_receipt` and `execution_trace`. Introduced when Claude produces a structured diff object. |
| `networkAccess: "allow_limited"` semantics | Domain allowlist, egress-only, port restriction rules. Deferred until real multi-step agent tasks require controlled outbound access. |
| Session resumability | A3 is intentional. Non-resumable is the safe default. Resumability requires session state management, conflict resolution on re-attach, and provenance chain extension. |
| Multi-session orchestration | One session = one agent task attempt. Sequencing (retry, pipeline, undo) is downstream product work. |
| Real filesystem candidate generation | Phase 8C delivers API-returned candidates from Claude. Full filesystem search (for generating candidates proactively) is deferred to Phase 8D. |
| Claude product session serialization / staleness | Phase 6C (CursorSession resilience) equivalent for Claude. Deferred until session interruption recovery is a product priority. |
| `getTimeline` Claude fields (`claudeHandoff`, `claudeReceipt`, `claudeRefused`) | Requires UCPBundle ownership review. |
| CLI / UI shell around Claude session | The product session API is proven. A real shell consumes it as-is. |
| Error-code display mapping | `session_interrupted` and `write_blocked` both surface as `exec_error`. Richer per-code display copy deferred to Phase 8D / presentation layer. |

---

## Consumer call sequence (V1 canonical)

### Via Claude product session (recommended)

```typescript
import {
  createClaudeSession, submitClaude, approveClaude,
  deliverClaude, answerClaudeScope, isClaudeTerminal,
} from "./src/product/index.js";
import { ClaudeApiAdapter } from "./src/claude/index.js";

const plugin = new ClaudeApiAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  bypass: ClaudeStubAdapter.accepted("ci-session"),  // for CI
});

let session = createClaudeSession();

// 1. Submit — runs intake + prepareClaudeExecution internally
session = submitClaude(session, userInput, policy, toolPolicy);
// session.phase: "prepared" | "conflict" | "not_execute" | "intake_failed"

// 2. Surface session.display to H

// 3a. If conflict — H must accept before approving
if (session.phase === "conflict") {
  session = acceptClaudeConflict(session);  // or rejectClaude(session)
}

// 3b. H approves (only valid from "prepared")
session = approveClaude(session);

// 4. Deliver — explicit separate act by the shell
session = await deliverClaude(session, plugin, storeDir);
// session.phase: "accepted" | "scope_question" | "exec_error" | "blocked"

// 5. If scope question — H selects from Claude's candidates
if (session.phase === "scope_question") {
  session = answerClaudeScope(session, selectedFile);  // must be from candidates
  session = await deliverClaude(session, plugin, storeDir);
}
```

### Via coordinator directly (lower-level)

```typescript
// 1. Run intake
const { result: intakeResult, ucp } = runIntakeWithUCP(input);
if (intakeResult.mode !== "execute") return;

// 2. Parse change (if structured command)
const pc = parseChange(input) ?? undefined;

// 3. Prepare — synchronous, no side effects, no API calls
const prep = prepareClaudeExecution(
  intakeResult, ucp.intent.id, ucp.response.id, policy, toolPolicy, pc,
);
// prep.kind: "ready_for_confirmation" | "conflict_detected" | "not_execute"

// 4. Surface to H — H may narrow, acceptClaudeConflict, or reject

// 5. H approves
const approved = approveClaudeArtifact(prep.artifact, Date.now());

// 6. Deliver — async, real Anthropic API call
const result = await deliverClaudeExecution(approved, plugin, storeDir);
// result.kind: "accepted" | "refused_due_to_scope" | "refused_due_to_execution_error" | "blocked_*"
```

---

## Key design decisions (rationale)

**Why two phases?**  
Preparation must be explainable to H before anything calls the Anthropic API.  
A single async call would conflate "what will happen" with "making it happen."  
The split enforces explain-before-dispatch at the architectural level.

**Why does the adapter build prompts from taskSpec only?**  
The raw user input is not a governed artifact — it is an intention that the intake
pipeline has interpreted and constrained. Passing it directly to Claude would allow
re-interpretation of user intent outside the governed control stack (violates A4).  
`taskSpec` is the approved, structured representation. It is what H implicitly approved.

**Why is scope refusal not automatically resolved?**  
Automatic file selection is silent scope expansion.  
The system does not have permission to decide which file H intended.  
H must select from `scopeQuestion.candidates` — the exact set Claude found.

**Why is networkAccess "deny" the only V1 value?**  
"allow_limited" requires domain allowlists, egress-only enforcement, and port
restriction rules that are not yet designed. Shipping with an undefined trust model
for outbound requests would create an unauditable security surface. Deny is the
safe default until that design work is done.

**Why is the API response sessionId = Anthropic message id?**  
The Anthropic API response `.id` is unique per API call and is the closest available
identifier for the managed session. It is suitable for provenance lookup. In V1, it
is not a managed session handle — it is an attempt identifier. When Anthropic surfaces
a dedicated session concept, it will replace this.

**Why no auto-retry on session_interrupted?**  
A3 is intentional. Retry logic without session state recovery risks applying a partial
edit twice or executing an already-completed task again. The safe default is: interrupted
is terminal; H decides whether to create a new session and re-submit.
