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

**GitHub is the database.** Every read and write goes straight through the GitHub REST/Git Data API (`src/lib/github.ts`) — there's no local filesystem storage and no separate database, in dev or in production. This is deliberate: Vercel's serverless functions don't persist filesystem writes across requests or deploys, so a change only becomes real, and visible to every visitor and to the live Rydr app's catalog fetch, the moment it lands as a commit.

- Every marketplace item is still a folder under `data/<category>/<item-id>/` in this repo, holding a `manifest.json` (name, author, description, version, dates, download count, tags) and a `files/` directory with the item's actual package contents — human-browsable on GitHub exactly like before.
- `data/index.json` is a flat array of every item's full metadata, kept in sync with the per-item `manifest.json` files in the same commit on every write. It's the one file every listing page fetches, so browsing never has to enumerate a GitHub directory.
- `/admin` (open, no-auth) does real create/edit/delete: each action reads `data/index.json` fresh, computes the change, and commits the updated index plus the affected `manifest.json`/`files/*` in **one atomic commit** via the Git Data API (blob → tree → commit → ref update). A conflicting concurrent write (someone else committed in between) is retried once automatically.
- **`/admin/upload` ("Add Extension")** uploads a `.zip` or `.skill` archive (optionally containing a `manifest.json` or `<id>-meta.json` at its root to auto-fill the form) and commits it the same way, sharing the same `createItem` commit logic as the manual form.
- `/api/manifest` aggregates every enabled item into the exact JSON shape Rydr's own **Settings ▸ Plugins ▸ Catalog source** already parses (see `RydRPlugins.refreshCatalog()` in the Rydr repo) — paste that URL into a live Rydr app to install straight from this marketplace, no Rydr code changes required for Plugins, Screensaver Widgets, View Extensions, and Tools & Utilities. Track HUD Themes and App Themes ship as color data and currently self-apply (Rydr has no native theme-install hook yet).
- Each item's `files/` contents are also reachable directly via `raw.githubusercontent.com` once pushed, which Rydr's plugin loader already trusts for `entryUrl`.
- Zip archives are created (for item downloads) and read (for uploads) with [`@zip.js/zip.js`](https://gildas-lormeau.github.io/zip.js/) — see `src/lib/archive.ts`.

Because every read hits the GitHub API too, **local dev (`npm run dev`) needs a working `GITHUB_TOKEN` and network access** — there's no offline fallback against a local `data/` copy.

## Environment variables

Copy `.env.example` to `.env` for local development, or set these in the Vercel project's Environment Variables for production:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes — everywhere, including local dev | A personal access token with write access to this repo. All reads and writes (browsing, `/admin`, uploads) go through the GitHub API. |
| `GITHUB_REPO` | No (defaults to this repo) | `owner/name` to read/write, if forked. |
| `GITHUB_BRANCH` | No (defaults to `main`) | Branch to read/commit against. |
