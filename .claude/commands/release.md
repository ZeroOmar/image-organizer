Release a new version of Image Organizer.

## Steps

### 1. Determine the next version

If the user specified a version explicitly in their message, use that.

Otherwise, read the current version from the root `package.json` (`"version": "x.y.z"`) and decide the bump by reviewing the diff (step 2 below). Apply semver rules:

- **major** (x+1.0.0): breaking changes, such as removed/renamed `APP_CONFIG` keys or env vars, removed/renamed API endpoints, changed mounts, DB migrations that can't be rolled back, or a changed default rename template
- **minor** (x.y+1.0): new user-visible features, such as new pages, batch actions, automation steps, filters, endpoints, settings or config keys
- **patch** (x.y.z+1): bug fixes, internal refactors, documentation only

When in doubt between two levels, pick the higher one. State your reasoning in one sentence before proceeding.

### 2. Collect changes since the last release

Run both commands to understand what changed:
```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
git diff $(git describe --tags --abbrev=0)..HEAD
```

Group the changes into categories: Fixed, Security, Changed, Added, Removed.
Write clear human-readable entries, not just commit hashes.

Then finalize the version bump decision from step 1 based on what you found.

### 3. Verify the build

Before touching versions, make sure the tree is releasable:

```bash
npm run typecheck
npm test
npm run build
```

If anything fails, stop and report it to the user instead of releasing.

### 4. Update version in source

The version lives in **every** `package.json` (root, `packages/shared`, `apps/server`, `apps/web`) plus `package-lock.json`. Bump them all to NEW in one go:

```bash
npm version NEW --no-git-tag-version --workspaces --include-workspace-root
```

Then confirm with `git grep -n '"version"' -- '*package.json'` that all four read NEW. (At runtime the app reads `APP_VERSION` from the Docker build, falling back to the root `package.json`; see `apps/server/src/version.ts`.)

### 5. Write the release notes

There is no CHANGELOG.md: each release's notes live in its **annotated git tag message**, and CI publishes them to the GitHub Releases page (`.github/workflows/release.yml`). Write the notes to a file in the scratchpad dir so they can be passed to `git tag -F` in step 7:

```
NEW_VERSION

### Fixed
- ...

### Changed
- ...
```

The first line is the tag subject (just the version). Then the grouped notes. Only include categories that have entries (Fixed, Security, Changed, Added, Removed). Keep the house style: bold lead phrase, em dash, then a clear explanation. This text becomes the GitHub Release body verbatim. Mention anything users must do when upgrading (config keys, mounts, compose changes) under **Changed** or **Removed**.

### 6. Update README.md and other docs

Scan for references to the old version number (`git grep -n OLD -- . ':!package-lock.json'`) and update them: `CLAUDE.md` ("currently x.y.z"), the README release example, and the comment in `.github/workflows/docker-publish.yml`.
If new config keys, env vars, API endpoints, pages or steps were added, check that `docs/` (configuration.md, api.md, ui.md, automation.md, …) and `docker-compose.example.yml` cover them.

### 7. Stage, commit, tag, push

Use an **annotated** tag whose message is the notes file from step 5. Pushing the tag is what triggers CI to build the Docker image and create the GitHub Release:

```bash
git add -A
git commit -m "NEW_VERSION - BRIEF_SUMMARY

LONGER_DESCRIPTION_IF_NEEDED"
git tag -a NEW_VERSION --cleanup=verbatim -F <notes-file>   # annotated: message becomes the GitHub Release body
git push
git push origin NEW_VERSION
```

The commit message subject should be `{version} - {one-line summary of the most significant change}`.

### 8. Confirm the release published

Pushing the tag triggers two workflows. Confirm both succeeded (`gh run list --limit 4`, then `gh run watch <id>` if still running):

- `.github/workflows/docker-publish.yml` builds amd64+arm64 and pushes `ghcr.io/zeroomar/image-organizer:NEW_VERSION`, `:MAJOR.MINOR` and `:latest`.
- `.github/workflows/release.yml` reads the annotated tag message and publishes it at `https://github.com/ZeroOmar/image-organizer/releases/tag/NEW_VERSION`.

## Important

- Do not skip the diff review: release notes must reflect actual code changes, not guesses.
- The tag **must be annotated** (`git tag -a`). A lightweight tag has no message, so CI would fall back to auto-generated commit-title notes instead of your curated prose.
- Always pass `--cleanup=verbatim` when tagging. Without it, git strips lines starting with `#` as comments, which silently deletes Markdown `###` section headers from the notes.
- Tags are bare semver (`0.2.0`, not `v0.2.0`); both workflows trigger on `*.*.*`.
- Keep all four `package.json` files and `package-lock.json` in sync; all must read NEW.
- Do not create a release if there are uncommitted changes unrelated to the release (ask the user first).
- Confirm the tag and push steps with the user before running them, since they are not reversible.
