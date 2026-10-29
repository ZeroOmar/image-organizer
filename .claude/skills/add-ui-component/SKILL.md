---
name: add-ui-component
description: Build or change UI in Image Organizer's web app following design.md (Nomad green, dark surfaces, eyebrows), the theme tokens, the resizable workspace panes and the ActionDialog pattern.
---

# Add a UI component

Read `docs/ui.md` first. Rules:

- **Tokens only**: colors, radii and spacing come from CSS variables in `apps/web/src/theme/tokens.css`. Put styles in `apps/web/src/theme/app.css` (no CSS-in-JS libraries; small inline layout styles are fine).
- **Design** (`design.md`, Nomad green):
  - Dark surfaces lift `--canvas` → `--surface-1` → `--surface-2`, with no shadows.
  - The primary action is `.btn-primary` (green, dark text). Secondary is `.btn`. Destructive is `.btn-danger`. `.btn-white` is for a standout neutral CTA (e.g. Upload).
  - Every section or pane gets an uppercase `.eyebrow` label. Cards use `.card` (12px radius); inputs use `.input`; tags use `.pill`/`.pill-accent`/`.pill-warning`/`.pill-error`.
  - Never use the logo's petal colors or other product accents.
- **Panes**: inside the workspace, use `.pane` > `.pane-head` (tabs with `.tab`/`.active`) + `.pane-body`. New splits use `Group`/`Panel`/`Separator` from `react-resizable-panels` v4 with numeric px or `"NN%"` strings, and persist with `useDefaultLayout({ id, storage: localStorage })`.
- **Dialogs**: `components/Dialog.tsx` (Escape and backdrop close). For anything that changes files, use `components/ActionDialog.tsx` so the user always sees a dry run first.
- **Data**: add hooks in `api/hooks.ts`. Keep query keys in `keys`. Jobs refresh data automatically via SSE (`invalidateFiles`).
- **Responsive**: pages use `.page-inner`. Make sure layouts wrap (`.row` wraps; `.grid-2` auto-fits).

Check it: `npm run typecheck`, then the `run-and-verify` skill. Screenshot the page and look at it.
