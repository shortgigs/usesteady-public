---
name: Recovery Basic
description: Offer safe, explicit next-step suggestions when a UseSteady request was unsupported, blocked by policy, or failed at runtime — and a deterministic suggestion would genuinely help the user continue.
version: 1.0.0
kind: recovery
triggers:
  - unsupported input after deterministic parse failed
  - operation blocked by policy
  - runtime failure (file not found, value not present)
  - ambiguous intent that could not be parsed
output_schema: usesteady.recovery_suggestions.v1
requires_review: true
can_execute: false
can_call_tools: false
can_bypass_policy: false
can_bypass_approval: false
risk_level: low
priority: 100
---

## Purpose

When UseSteady cannot act — because the input was unsupported, blocked, or failed — the user is left without a path forward. This skill generates safe, explicit suggestions that the user can adopt, modify, or ignore.

A suggestion is only useful if it:
- maps to an operation UseSteady can actually validate and execute
- does not widen the scope of what the user asked for
- makes it immediately clear what the user would need to do next

This skill does not retry execution, bypass policy, or decide what the user should do. It only offers options.

---

## When to use

Run this skill only when **all** of the following are true:

1. One of these outcomes occurred:
   - Deterministic parser returned null and no interpretation skill produced a valid candidate.
   - The operation was blocked by policy.
   - The operation failed at runtime (e.g. file not found, replace target not present).
2. A concrete suggestion would genuinely reduce user friction — not just restate the error.
3. The suggestion can be expressed as an exact UseSteady-supported input phrase.

Do **not** run this skill if:
- The failure was caused by a missing required field the user must supply (ask for clarification instead).
- The request is fundamentally unsupported and no nearby alternative exists.
- A suggestion would require guessing at user intent or widening scope.

---

## Output contract

Schema: `usesteady.recovery_suggestions.v1`

```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": {
    "name": "Recovery Basic",
    "version": "1.0.0"
  },
  "suggestions": [
    {
      "input": "create folder components",
      "reason": "Closest deterministic supported form of your request"
    },
    {
      "input": "create folder src/components",
      "reason": "Explicit path variant if you intended a nested location"
    }
  ]
}
```

Rules:
- Every `input` must be a phrase UseSteady can validate and execute as-is.
- `reason` is required for every suggestion and must explain why this specific form is offered.
- Do not suggest operations that UseSteady does not support.
- Do not suggest unsupported scope or operations that exceed what the user implied.
- `suggestions` may be empty if no safe, explicit alternative exists — do not fabricate.
- Suggestions must not imply the original action was or will be executed.
- Limit to the 2–3 most useful suggestions. Do not exhaust all permutations.

---

## Guardrails

1. **No execution.** Do not run the suggestion. Do not call any tool. Do not modify the filesystem.
2. **No hidden guessing.** If the right suggestion requires knowing something the user did not say, return `suggestions: []`.
3. **No scope widening.** If the user asked to delete `temp.txt`, do not suggest deleting the whole `temp/` directory.
4. **No approval influence.** Suggestions are options for the user to choose from. Each one still enters the normal approval flow.
5. **No policy influence.** If an operation was blocked by policy, do not suggest a workaround that bypasses it.
6. **No canonical state.** Suggestions are transient. They are recorded as advisory provenance in the audit trail, not as execution truth.

---

## Examples

### Context: ambiguous input — parser returned null

Suggest the closest deterministic form. Name the specific part of the input that was unclear.

**Input:** `make a folder for components`
```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": { "name": "Recovery Basic", "version": "1.0.0" },
  "suggestions": [
    {
      "input": "create folder components",
      "reason": "Deterministic form of your request — 'for components' interpreted as the folder name"
    }
  ]
}
```

**Input:** `delete cache`
```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": { "name": "Recovery Basic", "version": "1.0.0" },
  "suggestions": [
    {
      "input": "delete folder cache",
      "reason": "Explicit form that names the entity type — use if cache is a directory"
    },
    {
      "input": "delete file cache",
      "reason": "Explicit form — use if cache is a single file"
    }
  ]
}
```

### Context: runtime failure — file not found

Suggest corrective actions the user can take.

**Input:** `rename Button.tsx to PrimaryButton.tsx` (file not found)
```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": { "name": "Recovery Basic", "version": "1.0.0" },
  "suggestions": [
    {
      "input": "create file Button.tsx",
      "reason": "Create the missing source file before attempting to rename it"
    },
    {
      "input": "rename src/Button.tsx to src/PrimaryButton.tsx",
      "reason": "Try with an explicit path if the file exists in a subdirectory"
    }
  ]
}
```

### Context: runtime failure — replace target not found

**Input:** `replace "logLevel: 'warn'" with "logLevel: 'debug'" in src/config/app.config.ts` (value not found)
```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": { "name": "Recovery Basic", "version": "1.0.0" },
  "suggestions": [
    {
      "input": "replace \"logLevel: 'warn'\" with \"logLevel: 'debug'\" in src/config/app.config.ts",
      "reason": "Retry with identical phrasing after confirming the exact string exists in the file"
    }
  ]
}
```

### Context: unsupported operation — no safe suggestion

**Input:** `publish the package to npm`
```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": { "name": "Recovery Basic", "version": "1.0.0" },
  "suggestions": []
}
```
Reason: Publishing to npm is not a UseSteady filesystem primitive. No safe suggestion exists.

### Context: policy block — no bypass suggestion

**Input:** (operation blocked by policy)
```json
{
  "schema": "usesteady.recovery_suggestions.v1",
  "skill": { "name": "Recovery Basic", "version": "1.0.0" },
  "suggestions": []
}
```
Reason: Suggestions that work around a policy block are not permitted. The user must change the policy through the operator interface, not reframe the request.
