---
name: Workflow Draft Basic
description: Decompose a broad or multi-step user request into an ordered sequence of reviewable UseSteady task inputs when the user explicitly asks for a setup, scaffold, or multi-step outcome.
version: 1.0.0
kind: workflow_generation
triggers:
  - set up a new project
  - scaffold an auth module
  - create the folder structure for a React app
  - set up the components directory with an index
  - initialise the feature flag system
  - bootstrap a new API route
output_schema: usesteady.workflow_draft.v1
requires_review: true
can_execute: false
can_call_tools: false
can_bypass_policy: false
can_bypass_approval: false
risk_level: low
priority: 100
---

## Purpose

When a user asks for a broader outcome — scaffolding a module, bootstrapping a folder structure, setting up a feature area — the deterministic parser returns null because no single primitive covers the whole request.

This skill decomposes the request into an ordered sequence of UseSteady task inputs. Each step must be a phrase that the deterministic parser or `filesystem-basic` interpretation skill can independently validate. The user reviews the entire draft workflow before a single step executes.

This skill is about drafting, not deciding. UseSteady validates every step before it appears as a SYSTEM WILL.

---

## When to use

Run this skill only when **all** of the following are true:

1. The user explicitly requests a multi-step outcome using signals like: set up, scaffold, initialise, bootstrap, create the structure for, build out, add the full, wire up.
2. The request implies two or more distinct filesystem operations.
3. No single deterministic primitive covers the full request.

Do **not** run this skill if:
- The request maps to a single operation (use the deterministic parser or `filesystem-basic`).
- The user has not explicitly asked for a broader outcome — do not assume multi-step when one step is sufficient.
- The steps cannot be expressed as phrases that UseSteady can validate deterministically.

---

## Output contract

Schema: `usesteady.workflow_draft.v1`

```json
{
  "schema": "usesteady.workflow_draft.v1",
  "skill": {
    "name": "Workflow Draft Basic",
    "version": "1.0.0"
  },
  "name": "Set up auth folder",
  "steps": [
    {
      "input": "create folder auth",
      "reason": "Create top-level auth directory"
    },
    {
      "input": "create file auth/index.ts",
      "reason": "Add module entry point"
    },
    {
      "input": "create file auth/types.ts",
      "reason": "Add types file alongside entry point"
    }
  ]
}
```

Rules:
- Every `input` must be a phrase UseSteady can validate — phrased identically to how a user would type it in the workflow builder.
- `reason` is required for every step and must be human-readable.
- Do not include steps for operations UseSteady does not support as deterministic primitives.
- Do not infer steps beyond what the user explicitly or strongly implied.
- `steps` may be empty if the request is too vague to decompose safely — do not fabricate steps.
- The `name` field should be a concise human label for the draft workflow.

---

## Guardrails

1. **No execution.** This skill produces a draft. No tool calls. No filesystem actions.
2. **No hidden guessing.** Do not add steps the user did not ask for. If the scope is unclear, return fewer steps or an empty draft.
3. **No scope widening.** If the user said "set up auth", do not invent a full authentication system with sessions, tokens, and middleware. Draft only what is stated.
4. **No approval influence.** Every step in the draft still requires individual approval in the normal UseSteady flow.
5. **No policy influence.** This skill does not decide which steps are allowed. UseSteady validates each step independently.
6. **No canonical state.** The draft is a suggestion. It is never written to the audit trail as an approved plan.

---

## Examples

### Positive — draft emitted

**Input:** `set up an auth folder`
```json
{
  "schema": "usesteady.workflow_draft.v1",
  "skill": { "name": "Workflow Draft Basic", "version": "1.0.0" },
  "name": "Set up auth folder",
  "steps": [
    { "input": "create folder auth", "reason": "Create the auth directory" },
    { "input": "create file auth/index.ts", "reason": "Add module entry point" }
  ]
}
```

**Input:** `scaffold a components folder with an index file`
```json
{
  "schema": "usesteady.workflow_draft.v1",
  "skill": { "name": "Workflow Draft Basic", "version": "1.0.0" },
  "name": "Scaffold components folder",
  "steps": [
    { "input": "create folder components", "reason": "Create the components directory" },
    { "input": "create file components/index.ts", "reason": "Add barrel export file" }
  ]
}
```

**Input:** `create the folder structure for a feature flag module`
```json
{
  "schema": "usesteady.workflow_draft.v1",
  "skill": { "name": "Workflow Draft Basic", "version": "1.0.0" },
  "name": "Feature flag module structure",
  "steps": [
    { "input": "create folder feature-flags", "reason": "Create top-level module directory" },
    { "input": "create file feature-flags/index.ts", "reason": "Add module entry point" },
    { "input": "create file feature-flags/types.ts", "reason": "Add types file" }
  ]
}
```

### Negative — empty draft returned

**Input:** `set up a full authentication system with JWT and refresh tokens`
```json
{
  "schema": "usesteady.workflow_draft.v1",
  "skill": { "name": "Workflow Draft Basic", "version": "1.0.0" },
  "name": "",
  "steps": []
}
```
Reason: "JWT and refresh tokens" requires implementation logic, not filesystem primitives. Drafting steps would require guessing file contents and architecture — scope widening.

**Input:** `make the app better`
```json
{
  "schema": "usesteady.workflow_draft.v1",
  "skill": { "name": "Workflow Draft Basic", "version": "1.0.0" },
  "name": "",
  "steps": []
}
```
Reason: No concrete filesystem scope. Any steps emitted would be invented, not implied.
