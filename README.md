# Rydr Extensions Marketplace

A VS Code Marketplace-style site for add-ons to the [Rydr](https://github.com/electricplatypus/rydr) motorcycle dashboard app: Track HUD themes, app themes, plugins, screensaver widgets, view extensions, and tools/utilities — browsable, sortable (date/name/downloads), downloadable, and manageable via an admin CRUD.

## Development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## How it works

- Every marketplace item is a folder under `data/<category>/<item-id>/`, holding a `manifest.json` (name, author, description, version, dates, download count, tags) and a `files/` directory with the item's actual package contents. No database — the filesystem is the source of truth.
- `/admin` is an open (no-auth) CRUD dashboard for creating, editing, and deleting items in any category.
- `/api/manifest` aggregates every enabled item into the exact JSON shape Rydr's own **Settings ▸ Plugins ▸ Catalog source** already parses (see `RydRPlugins.refreshCatalog()` in the Rydr repo) — paste that URL into a live Rydr app to install straight from this marketplace, no Rydr code changes required for Plugins, Screensaver Widgets, View Extensions, and Tools & Utilities. Track HUD Themes and App Themes ship as color data and currently self-apply (Rydr has no native theme-install hook yet).
- Each item's `files/` contents are also reachable directly via `raw.githubusercontent.com` once pushed, which Rydr's plugin loader already trusts for `entryUrl`.
