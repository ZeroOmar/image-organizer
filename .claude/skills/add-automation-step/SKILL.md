---
name: add-automation-step
description: Make a step available in Image Organizer automation rules (rule editor UI, defaults, params, dry run) or add a new trigger type for rules.
---

# Add an automation step

Automation rules reuse batch Steps, so first make sure the step exists (the `add-batch-action` skill). Then:

1. Set `automation: true` in `STEP_INFO` (`packages/shared/src/api.ts`). The rule editor's "Add step" list is built from this.
2. Add a sensible default in `defaultStep()` in `apps/web/src/pages/Automation.tsx`.
3. Add a params editor case in `StepParams` (same file). Steps without params need nothing.
4. The step must be **idempotent**: scheduled and watched runs skip when the plan has no ops (`submit(..., {skipIfEmpty: true})`), and they re-run on the same files. Make the planner skip files that already match.
5. Add it to the table in `docs/automation.md`.
6. Test: create a rule through the API in `apps/server/test/` (`POST /api/rules`), call `POST /api/rules/:id/plan` and assert the items, then `POST /api/rules/:id/run` and wait for the job.

## New trigger type

Triggers live in `apps/server/src/automation/automation.ts` → `arm()`/`disarm()`. Add the field to `RuleSchema`, arm and disarm it there, call `this.run(rule.id, files?, true)` for automatic runs, and add the toggle to `RuleEditor`.
