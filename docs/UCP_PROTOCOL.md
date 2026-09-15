# UseSteady Control Protocol (UCP)

## Purpose

UCP is the canonical system language for usesteady-core-v2.

Every decision that flows through UseSteady is representable as a UCPEnvelope.  
Envelopes are versioned, content-addressed, deterministically hashable, and replayable.

UCP is the answer to: *"What happened, and can you prove it happened that way?"*

---

## What UCP is

- A **structured representation** of every pipeline stage output
- A **canonical identity** system — same content → same `id`, always
- A **replay foundation** — envelopes can be reconstructed from content alone
- A **parallel view** alongside the authoritative `IntakeResult`
- A **developer-facing audit trail** for every run

---

## What UCP is NOT

- Not an execution engine — it never decides anything
- Not a transport layer — it does not serialize or send messages
- Not a logic layer — it does not branch, gate, or filter
- Not a storage mechanism — in-memory only in this phase
- Not the source of routing authority — `result.mode` is still the only handoff

---

## Envelope structure

```typescript
type UCPEnvelope<TPayload> = {
  id:      string;   // sha256({ type, payload, refs }) — content-addressed
  type:    string;   // "ucp.intent.v1", "ucp.prv.v1", etc.
  version: 1;
  ts:      number;   // epoch ms — recorded but excluded from id and hash
  payload: TPayload; // exact fields from the source type, no invention
  meta: {
    source:        string; // module that produced this envelope
    deterministic: true;   // always true in v1
  };
  refs?: {
    parentId?: string; // id of the immediate causal predecessor in the envelope chain
    rootId?:   string; // id of the originating intent envelope — always ucp.intent.v1
  };
  hash:    string;   // sha256({ id, meta, payload, refs, type, version })
};
```

### id derivation

```
id = sha256(stableStringify({ type, payload, refs }))
```

- Excludes `ts` — id is stable across time
- Same content always produces the same id
- Changing payload, type, or refs changes the id

### hash derivation

```
hash = sha256(stableStringify({ id, meta, payload, refs, type, version }))
```

- Excludes `ts` and `hash` itself
- Changing any stable field changes the hash
- `meta.source` changes the hash — source identity is part of integrity

---

## Envelope families

| Type string | Source type | Module |
|-------------|-------------|--------|
| `ucp.intent.v1` | raw input string | `intake` |
| `ucp.prv.v1` | `PRVResult` | `prv` |
| `ucp.safety.v1` | `SafetyResult` | `safety` |
| `ucp.context.v1` | `ContextAlignmentResult` | `context` |
| `ucp.disambiguation.v1` | `DisambiguationResult` | `disambiguation` |
| `ucp.completion.v1` | `CompletionResult` | `completion` |
| `ucp.intent_interpretation.v1` | `IntentInterpretation` | `intent_interpretation` |
| `ucp.change_interpretation.v1` | `InterpretationResult` | `change_interpretation` |
| `ucp.response.v1` | `IntakeResult` | `response_planner` |
| `ucp.interaction_contract.v1` | `InteractionContract` | `interaction` |
| `ucp.interaction_event.v1` | `InteractionEvent` | `interaction` |
| `ucp.debug_trace.v1` | `DebugTrace` | `intake` |

---

## Mapping rules

1. **Exact field transfer** — mapper output contains only fields present in the source type. No invention.
2. **No logic branching** — mappers use conditional spreads only for optional fields, never for decisions.
3. **No mutation** — mappers are pure functions. Input types are never modified.
4. **No re-interpretation** — if source says `verdict: "block"`, the envelope says `verdict: "block"`. No softening, no escalation.
5. **Optional fields preserved** — `detectorId`, `matchedPattern`, `reason`, `normalized`, etc. are present when the source has them, absent when the source does not.

---

## Determinism guarantee

Two calls to `createEnvelope(type, payload, source, refs)` with identical arguments will produce:
- identical `id`
- identical `hash`
- different `ts` (timestamps differ — this is expected and intentional)

This means envelope identity is content-based, not time-based.  
A replay system can verify a past run by reconstructing envelopes from recorded payloads.

---

## UCPBundle — the pipeline tap

`runIntakeWithUCP(input, ctx)` returns:

```typescript
{
  result:  IntakeResult,  // authoritative — same as runIntakeWithTrace
  trace:   DebugTrace,    // same as runIntakeWithTrace
  ucp:     UCPBundle,     // parallel, read-only view
}
```

`UCPBundle` contains one envelope per pipeline step that ran.  
Steps that were short-circuited (e.g., safety blocked before context ran) produce no envelope.

**Always present:**
- `intent` — the raw input
- `response` — the final decision
- `debugTrace` — the pipeline trace

**Present only when the step ran:**
- `prv` — when PRV was reached (always, unless the function was called incorrectly)
- `safety` — when safety gate ran (all non-PRV-blocked runs)
- `context` — when context alignment ran (PRV-passed runs)
- `disambiguation` — when disambiguation ran (context-aligned runs)
- `completion` — when completion ran (non-ambiguous runs through disambiguation)
- `intentInterpretation` — when bridge fired and classified intent
- `changeInterpretation` — when change interpretation ran on an execute result

---

## Ownership boundaries

```
Core pipeline (authoritative)
  → emits IntakeResult + DebugTrace

UCP layer (parallel view)
  → maps pipeline outputs into envelopes
  → adds id, hash, ts, meta
  → never modifies pipeline outputs

Presentation layer (consumer)
  → reads IntakeResult (projected)
  → does NOT consume UCP directly (deferred to Phase 2)

External consumers / seam
  → read result.mode for routing decisions
  → may read ucp for audit, replay, and observability
  → MUST NOT use ucp envelopes for routing decisions
```

---

## Invariants

**Core (non-negotiable):**

1. `result.mode` is the only routing authority. No envelope may change a routing decision.
2. Mappers are pure functions. They produce, never consume decisions.
3. `id` is content-addressed. `ts` never affects `id` or `hash`.
4. `hash` covers all stable fields. `ts` and `hash` itself are excluded.
5. No envelope may be created outside of `createEnvelope()`.

**Zero authority (non-negotiable):**

6. `ucp.intentInterpretation` being present does NOT escalate mode to execute.
7. `ucp.debugTrace.bridgeFired === true` does NOT change mode.
8. `ucp.safety.payload.verdict === "block"` in an envelope is a record, not a new gate.
9. A consumer that reads a UCP envelope to make a routing decision is wrong.

**Determinism (non-negotiable):**

10. `createEnvelope(type, payload, source, refs)` with same args → same `id` and `hash`.
11. Pipeline re-runs (for mapper input) produce identical decisions to the authoritative run.

**Refs semantics (universal, applies to all envelope families):**

12. `parentId` always means **immediate causal predecessor**: the envelope that directly produced or preceded the current one in the same chain step. Example: `ucp.replay-report.v1.refs.parentId` = the `ucp.artifact.v1` ID for the same run.

13. `rootId` always means **originating intent envelope ID**: the `ucp.intent.v1` envelope that began the chain leading to this envelope. This is the ID of the raw user input that ultimately caused the outcome. It is always a `ucp.intent.v1` ID — no other type may be a `rootId`.

14. An envelope that omits `refs` is a **chain root or standalone decision** — it represents an event that has no predecessor within the current UCP model (e.g., `ucp.intent.v1` itself, which starts the chain).

15. `parentId` and `rootId` are both content-addressed IDs. A chain link that carries a wrong `parentId` is detectable — the ID will not match any known envelope.

---

## Phase 2 integration (complete as of April 2026)

Phase 2 replaced `formatIntakeResult` with `projectUCPBundle` as the canonical seam path. Every `UICoreIntakeResult` now carries `envelopeIds` (proof of UCP provenance). See `docs/UCP_PHASE3_DESIGN.md` for Phase 3 scope (artifact, replay, execution-trace families).

## Persistence Layer (Phase 4A — complete as of April 2026)

UCP envelopes are persisted to a local, append-only JSONL log at envelope-emission time.

**Storage location (caller-supplied `storeDir`):**
```
<storeDir>/
  envelopes.log   — append-only JSONL, one envelope per line
  index.json      — lightweight projection of the log (rebuildable)
```

Default path used by the CLI and API server: `~/.usesteady/ucp/`

**Append-only design:**
- Every `persistEnvelope(storeDir, envelope)` call appends exactly one line to `envelopes.log`.
- Lines are never rewritten or deleted. The log only grows.
- Each line is `stableStringify(envelope) + "\n"` — canonical, deterministic bytes.
  Same envelope content always produces the same bytes.

**Index strategy:**
- `index.json` maintains four lookups: `byId`, `byType`, `byRoot`, `byParent`.
- `byId` maps envelope id → byte offset in `envelopes.log` for O(1) seek reads (Phase 4B).
- `byRoot` groups all envelopes in a single intent chain (rootId = `ucp.intent.v1` id).
- `byParent` maps parent → direct children for provenance traversal.
- Index writes are atomic: written to `index.json.tmp`, then renamed. No partial state.
- First-write-wins for `byId`: duplicate ids do not overwrite the first occurrence's offset.

**Rebuild guarantee:**
- The index is a projection of the log. It can always be reconstructed from scratch.
- `rebuildIndex(storeDir)` scans the full log, skips corrupt lines, and writes a fresh index.
- The system remains functional even if `index.json` is deleted or corrupt.

**Zero-authority rule:**
- `persistEnvelope` is called fire-and-forget inside a `void async` block with `try/catch`.
- A persistence failure never surfaces as an execution failure.
- The only observable side effect of a failure is a `console.warn` line.
- Persistence does not affect mode, execution, replay, or any output visible to the renderer.

**Envelope ordering in the log:**
- `classifyInput` handler: `ucp.intent.v1`, `ucp.response.v1` (at classify time)
- `executeAcceptedPlan` handler: `ucp.artifact.v1`, `ucp.execution_trace.v1`, `ucp.replay_report.v1` (after run completes)

## Query Layer (Phase 4B — complete as of April 2026)

Phase 4B adds a read-only navigation layer over the persisted envelope history. All queries operate on the existing `envelopes.log` and `index.json` files written by Phase 4A. No new storage is introduced.

### id vs hash — locked distinction

Every `UCPEnvelope` carries two hash fields:

| Field | Input | Excludes | Purpose |
|-------|-------|----------|---------|
| `id`   | `{ type, payload, refs }` | `ts`, `meta`, `version`, `hash` | **Content identity.** Same decision → same id, regardless of wall-clock time or which module emitted the envelope. Use for provenance links, deduplication, chain navigation. |
| `hash` | `{ id, meta, payload, refs, type, version }` | `ts`, `hash` | **Integrity checksum.** Includes `meta.source` — two envelopes from different modules with identical content share the same `id` but have different `hash` values. Use for tamper detection of a specific persisted record. |

`id ≠ hash` — they are not redundant. `id` answers "what was decided". `hash` answers "does this stored record match what was originally produced".

### Reader primitives (`src/ucp/persistence/reader.ts`)

| Function | Behaviour |
|----------|-----------|
| `readEnvelopeAt(storeDir, offset)` | Seek to byte offset in `envelopes.log`, read one line, parse. Returns `null` for missing file, bad offset, or corrupt JSON. Uses `openSync`/`readSync` — does not load the full file. |
| `readAllEnvelopes(storeDir)` | Read and parse all valid lines in `envelopes.log`. Skips corrupt lines silently. Returns envelopes in log order (chronological). |

### Query functions (`src/ucp/persistence/query.ts`)

All query functions:
- **Follow refs only** — no relationship is inferred; every navigation step follows declared `refs.parentId` or `refs.rootId`
- **Return null / empty array** rather than throwing for missing or corrupt data
- **Do not cache** — each call reads from disk
- **Do not mutate** stored envelopes

| Function | Index used | Description |
|----------|------------|-------------|
| `getEnvelopeById(storeDir, id)` | `byId` | O(1) seek by content-addressed id |
| `getByType(storeDir, type)` | `byType` | All envelopes of one UCPType, in log order |
| `getChain(storeDir, intentId)` | `byId` + `byRoot` | Intent envelope + all descendants (response, artifact, trace, replay) |
| `getArtifactByRunId(storeDir, runId)` | `byType["ucp.artifact.v1"]` | Artifact envelope matching `payload.runId` |
| `getTraceByArtifactId(storeDir, artifactEnvId)` | `byParent` | Execution trace envelope with `refs.parentId === artifactEnvId` |
| `getReplayByArtifactId(storeDir, artifactEnvId)` | `byParent` | Replay report envelope with `refs.parentId === artifactEnvId` |
| `getTimeline(storeDir, intentId)` | all | Full `RunTimeline` — follows chain then children of artifact |

### `RunTimeline` shape

```typescript
type RunTimeline = {
  intent:   UCPEnvelope<unknown> | null;  // originating intent
  response: UCPEnvelope<unknown> | null;  // mode + reason + guidance
  artifact: ArtifactEnvelope | null;      // runId + goal + checksum
  trace:    ExecutionTraceEnvelope | null; // traceHash + kinds
  replay:   ReplayReportEnvelope | null;  // verdict + counts
};
```

A `null` field means that phase of the run is not yet recorded — not that a failure occurred.

### Zero-authority rule

Query functions are observability tools. They must not affect any runtime, intake, or execution behavior. Calling `getTimeline` ten times for the same intent must produce the same result as calling it once.

## Phase 3 integration (complete as of April 2026)

Phase 3 extended UCP into execution provenance. The full chain — `ucp.intent.v1` → `ucp.response.v1` → `ucp.artifact.v1` → `ucp.execution_trace.v1` / `ucp.replay_report.v1` — is now closed end-to-end in this repo. Envelopes are emitted at artifact finalization + replay completion (fire-and-forget, zero runtime authority). See `docs/UCP_COMPLETION_REVIEW.md` for the full state-of-protocol review and invariant registry.
