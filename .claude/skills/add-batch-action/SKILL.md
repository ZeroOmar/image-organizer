---
name: add-batch-action
description: Add a new file-changing batch action to Image Organizer (a new Step with dry-run planning, execution ops with undo, a BatchBar button + dialog, optional automation support, tests).
---

# Add a batch action (new Step)

Every mutation is a **Step** planned by `apps/server/src/jobs/planner.ts` and executed by `apps/server/src/jobs/engine.ts`. Follow this order.

1. **Schema**: in `packages/shared/src/api.ts`:
   - Add a variant to `StepSchema` (`z.object({ type: z.literal('myStep'), ...params })`).
   - Add `STEP_INFO.myStep = { label, description, automation: true|false }`.
2. **Plan**: in `planner.ts` `planStep()`, add a `case 'myStep':`.
   - Loop over `files` (VFiles: `v.cur` = current location, `v.entry` = simulated metadata).
   - Push concrete ops onto `plan.ops` (reuse the existing kinds: `writeTags` with a `snapshot` list, `copyTags`, `rename`, `move`, `utimes`, `trash`).
   - Push a `PlanItem` per file with `item(v, { before, after })`, or `{ error }` when a file can't be handled.
   - **Update the simulation** (`v.entry = {...}` or `setCur(v, to)`) so later steps see the change.
   - Skip files that wouldn't change; the dry run should only list real changes.
   - For metadata tags, build them in `apps/server/src/metadata/tags.ts` (mind the GPS `-n` rule in CLAUDE.md).
3. **Execute**: if you need a brand-new op kind, add it to the `Op` union, implement it in `engine.runOp()`, **push an UndoEntry**, handle it in `runUndo()`, and call `indexer.invalidate()` for touched files.
4. **UI**: add a dialog in `apps/web/src/organise/dialogs/` wrapping `ActionDialog` (pass `selection`, `steps` or `null`, and `invalid`). Add a button to the batch bar in `apps/web/src/pages/Organise.tsx` (and `Import.tsx` if relevant), plus a case in the `Dialogs` switch.
5. **Automation**: if `automation: true`, add a default in `defaultStep()` and a params editor in `StepParams` (`apps/web/src/pages/Automation.tsx`).
6. **Docs**: add it to the step table in `docs/automation.md`; update `docs/metadata-and-dates.md` if it writes tags.
7. **Tests**: in `apps/server/test/jobs.test.ts`, run the step with `runJob(...)`, assert the result with `exif(file, 'Tag')`, then undo and assert the file is restored.
8. `npm run typecheck && npm test`, then check it in the UI with the `run-and-verify` skill.
