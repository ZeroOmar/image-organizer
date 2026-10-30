---
name: add-metadata-filter
description: Add a filter facet or an issue check to Image Organizer's Organize/Import filter panel (new MediaMeta field read from ExifTool, facet definition, optional issue check + Settings toggle).
---

# Add a filter facet or issue check

## 1. Is the value already in `MediaMeta`?

Check `packages/shared/src/media.ts` → `MediaMeta`. If not:
- Add the field (optional) to `MediaMeta`.
- Read it in `apps/server/src/metadata/exiftool.ts` → `readMeta()` (`-n` raw values; use the `str`/`num`/`date` helpers).
- Cached metadata is keyed by size+mtime, so **existing cache rows won't have the field**. Clear the cache by appending a migration in `apps/server/src/db/db.ts`: `'DELETE FROM media_cache;'`.

## 2. Facet

Add a `FacetDef` to `FACETS` in `apps/web/src/organize/filters.ts`:

```ts
{ id: 'lens', label: 'Lens', keys: (e) => (e.meta.lens ? [e.meta.lens] : []), sort: 'key' }
```

`keys()` may return several keys (the file matches if any is selected). Use `labelOf` for display names. Filtering is OR within a facet, AND across facets. No server change is needed: facets are computed client-side.

## 3. Issue check (optional)

1. Add the id to `ISSUE_CHECK_IDS` in `packages/shared/src/settings.ts`.
2. Add an entry to `ISSUE_CHECKS` in `packages/shared/src/issues.ts`: `{ id, label, category: 'missing'|'mismatch'|'name', check: ({entry, resolved, settings, folder}) => message | null }`.
3. The Settings page checkbox, the Issues facet, the tile outline and the Metadata panel list update automatically. To mark a specific field in the Metadata panel, pass the id to `cls(...)` in `apps/web/src/organize/MetadataPanel.tsx`.
4. Add a unit test (shared) and/or an expectation in `apps/server/test/jobs.test.ts` → "resolves dates and flags issues".
5. Update the table in `docs/metadata-and-dates.md`.
