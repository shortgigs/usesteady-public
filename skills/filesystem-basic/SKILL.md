---
name: Filesystem Basic Ops
description: Translate natural language filesystem requests into deterministic intent candidates for UseSteady when the deterministic parser returned null but the request appears plausibly actionable.
version: 1.0.0
kind: interpretation
triggers:
  - make a folder for components
  - set up the auth directory
  - create a new folder for routes
  - add an index file to src
  - put a config file in the root
  - delete cache
  - move Button to components
output_schema: usesteady.intent_candidates.v1
requires_review: true
can_execute: false
can_call_tools: false
can_bypass_policy: false
can_bypass_approval: false
risk_level: low
priority: 100
---

## Purpose

Translate natural language filesystem requests into one or more `intent_candidates` that UseSteady can then validate against its deterministic primitives.

This skill handles the gap between what the deterministic parser can match exactly and what users commonly type. It does not decide correctness — it suggests candidates. UseSteady validates every candidate before presenting it as a SYSTEM WILL.

---

## When to use

Run this skill only when **all** of the following are true:

1. The deterministic parser returned `null` for the input.
2. The input contains a recognisable filesystem verb family: create, make, add, set up, scaffold, init, initialize, generate, spin up, delete, remove, rm, rename, move, mv, touch, mkdir, write.
3. The input appears to reference a concrete filesystem entity (folder, directory, dir, file) or a path-like token.

Do **not** run this skill if:
- The deterministic parser already returned a valid parse.
- The input is clearly a prose sentence with no actionable filesystem target (e.g. "explain what the auth folder is for").
- The input would require inventing a path that the user did not supply.

---

## Output contract

Schema: `usesteady.intent_candidates.v1`

```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": {
    "name": "Filesystem Basic Ops",
    "version": "1.0.0"
  },
  "candidates": [
    {
      "kind": "create_dir",
      "path": "components",
      "confidence": 0.85,
      "reason": "Request asks to make a folder for components; 'components' is the most literal path candidate."
    }
  ]
}
```

Rules:
- `candidates` may be empty — never fabricate a candidate when the target is ambiguous.
- Every candidate must include `kind`, the required path field(s), `confidence`, and `reason`.
- `confidence` is advisory; UseSteady does not use it for allow/deny decisions.
- `reason` must name the specific signal in the user input that justifies the candidate.
- Never emit a candidate for an operation that UseSteady does not support as a deterministic primitive.

### Supported candidate kinds

| kind | Required fields |
|---|---|
| `create_dir` | `path` |
| `create_file` | `path` |
| `rename` | `from`, `to` |
| `delete` | `path` |
| `replace` | `find`, `replace`, `file` |

---

## Guardrails

1. **No execution.** Do not call any tool. Do not touch the filesystem. Do not generate patches.
2. **No hidden guessing.** If the user did not supply a concrete path or name, return `candidates: []`. Do not invent a path.
3. **No scope widening.** If the user said "a folder for components", suggest `components` — not `src/components`, `app/components`, and a third variant.
4. **No approval influence.** Do not set any field that could imply the action is approved or safe to run.
5. **No policy influence.** Do not decide whether the operation is allowed. That is UseSteady's job.
6. **No canonical state.** This output is transient. It is never written to the audit trail as execution truth.

---

## Examples

### Positive — suggestion emitted

**Input:** `make a folder for components`
```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": { "name": "Filesystem Basic Ops", "version": "1.0.0" },
  "candidates": [
    {
      "kind": "create_dir",
      "path": "components",
      "confidence": 0.85,
      "reason": "'for components' names the folder directly; no other path is implied."
    }
  ]
}
```

**Input:** `set up the auth directory`
```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": { "name": "Filesystem Basic Ops", "version": "1.0.0" },
  "candidates": [
    {
      "kind": "create_dir",
      "path": "auth",
      "confidence": 0.80,
      "reason": "'auth directory' is a direct noun phrase; 'set up' maps to create_dir."
    }
  ]
}
```

**Input:** `delete cache`
```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": { "name": "Filesystem Basic Ops", "version": "1.0.0" },
  "candidates": [
    {
      "kind": "delete",
      "path": "cache",
      "confidence": 0.70,
      "reason": "'cache' is a clean single-token target for delete; no article/qualifier widened the scope."
    }
  ]
}
```

### Negative — empty candidates returned

**Input:** `create a good directory structure`
```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": { "name": "Filesystem Basic Ops", "version": "1.0.0" },
  "candidates": []
}
```
Reason: "a good directory structure" contains no concrete path. Inventing one would be scope widening.

**Input:** `delete everything`
```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": { "name": "Filesystem Basic Ops", "version": "1.0.0" },
  "candidates": []
}
```
Reason: "everything" is not a deterministic path. Emitting a delete candidate would be unsafe guessing.

**Input:** `remove the dependency on lodash`
```json
{
  "schema": "usesteady.intent_candidates.v1",
  "skill": { "name": "Filesystem Basic Ops", "version": "1.0.0" },
  "candidates": []
}
```
Reason: "dependency on lodash" is a package management concern, not a filesystem primitive.
