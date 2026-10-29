---
name: add-api-endpoint
description: Add a new HTTP endpoint to the Image Organizer server and consume it from the web app (shared zod schema → Fastify route → react-query hook → docs → test).
---

# Add an API endpoint

1. **Types/schema**: if the request or response shape is used by both sides, add a zod schema and/or TS interface to `packages/shared/src/api.ts` (exported from `index.ts`).
2. **Route**: add it to the matching module in `apps/server/src/http/routes/` (`browse.ts`, `jobs.ts`, `import.ts`, `admin.ts`), or create a new module and register it in `apps/server/src/http/app.ts` next to the others.
   - Validate input with `parse(Schema, req.query|req.body)` from `http/validate.ts`. Use `RefQuery` for `?root&rel`.
   - Resolve paths only with `ctx.roots.resolve({root, rel})`.
   - Throw `new HttpError(status, message)` for client errors.
   - **Never mutate files in a route.** If the endpoint changes files, make it a step (see the `add-batch-action` skill) or wrap it in `ctx.jobs.exclusive(...)`.
   - Auth and CSRF are automatic for `/api/*` (`auth/auth.ts`). Only add to the `PUBLIC` set if it truly must be unauthenticated.
3. **Client**: add a hook or function in `apps/web/src/api/hooks.ts` using `api<T>(path, {method, body})` from `api/client.ts` (it adds the CSRF header). Add a key to `keys` if it's a query.
4. **Docs**: add a row to `docs/api.md`.
5. **Test**: add a case to `apps/server/test/jobs.test.ts` (it has an `api()` helper with a logged-in cookie) or a new `apps/server/test/*.test.ts` using the same `beforeAll` setup.
6. Run `npm run typecheck && npm test`.
