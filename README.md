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

- Every marketplace item is a folder under `data/<category>/<item-id>/`, holding a `manifest.json` (name, author, description, version, dates, download count, tags) and a `files/` directory with the item's actual package contents. No database — the filesystem/repo is the source of truth.
- `/admin` is an open (no-auth) CRUD dashboard for creating, editing, and deleting items in any category. Its manual create/edit/delete forms write directly to the local filesystem, so they only take effect when run locally (`npm run dev`) against a real checkout — Vercel's serverless functions don't persist filesystem writes across requests or deploys.
- **`/admin/upload` ("Add Extension")** is the production-safe way to publish: upload a `.zip` or `.skill` archive (optionally containing a `manifest.json` or `<id>-meta.json` at its root to auto-fill the form), and the server extracts it and **commits the manifest + files straight to this GitHub repo** via the Git Data API — one atomic commit per upload. The new item shows up in the marketplace after the next deploy finishes (auto-deploy on push to `main` picks it up).
- `/api/manifest` aggregates every enabled item into the exact JSON shape Rydr's own **Settings ▸ Plugins ▸ Catalog source** already parses (see `RydRPlugins.refreshCatalog()` in the Rydr repo) — paste that URL into a live Rydr app to install straight from this marketplace, no Rydr code changes required for Plugins, Screensaver Widgets, View Extensions, and Tools & Utilities. Track HUD Themes and App Themes ship as color data and currently self-apply (Rydr has no native theme-install hook yet).
- Each item's `files/` contents are also reachable directly via `raw.githubusercontent.com` once pushed, which Rydr's plugin loader already trusts for `entryUrl`.
- Zip archives are created (for item downloads) and read (for uploads) with [`@zip.js/zip.js`](https://gildas-lormeau.github.io/zip.js/) — see `src/lib/archive.ts`.

## Environment variables

Copy `.env.example` to `.env` for local development, or set these in the Vercel project's Environment Variables for production:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes, for `/admin/upload` | A personal access token with write access to this repo, used to commit uploaded extensions. |
| `GITHUB_REPO` | No (defaults to this repo) | `owner/name` to commit into, if forked. |
| `GITHUB_BRANCH` | No (defaults to `main`) | Branch to commit uploads onto. |
