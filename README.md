# Rydr Extensions Marketplace

A VS Code Marketplace-style site for add-ons to the [Rydr](https://github.com/electricplatypus/rydr) motorcycle dashboard app: Track HUD themes, app themes, plugins, screensaver widgets, view extensions, and tools/utilities — browsable, sortable (date/name/downloads), downloadable, and manageable via an admin CRUD.

**Production:** https://rydr-extensions.vercel.app/

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
- Download counts live in their own `data/downloads.json` (a flat `"category/id" -> count` map), deliberately separate from `data/index.json`/`manifest.json` — a download shouldn't land in the same commit as a real edit, and `vercel.json`'s `ignoreCommand` skips a rebuild for a commit that only touches this file. Counts are still fully live: `getIndex()` merges them in on every read, so nothing needed a redeploy to show up in the first place.
- **`data/route-maps/`** is a separate, parallel catalog for RydR's Route Exchange plugin (shared motorcycle routes, not installable code/themes) — `data/route-maps/index.json` is its own flat index, and each route's geometry lives at `data/route-maps/<route-id>/route.json` (`{ points: [{lat, lng}, ...] }`). The default write path doesn't commit straight to `main`: `POST /api/route-maps/submit` (called cross-origin from the RydR app itself, hence the CORS headers on that route) opens a pull request on a `route-submission/<id>` branch instead, via `createBranch`/`commitFilesToBranch`/`openPullRequest` in `src/lib/github.ts`. A public, unauthenticated submission form writing straight into a live repo would be an open spam vector, so every submitted route lands as `status: "pending"` and only counts as published once its PR is merged (and its index entry flipped to `"approved"` as part of that).
  - **`/admin/route-maps`** — same-origin admin page (no GitHub login needed, same trust model as `/admin` itself: it's an unlisted page, not access-controlled) listing every pending submission with one-tap **Approve**/**Reject**. Approve calls `approveSubmission()` in `src/lib/routeMaps.ts`, which merges the PR (squash) and then flips the entry's `status` to `"approved"` in a follow-up commit — the whole reason this exists is so approving a route never requires opening github.com. Reject closes the PR without merging and best-effort deletes its branch.
  - **`POST /api/route-maps/direct-add`** — the one write path that skips review entirely: validates a submission exactly like `/submit` does (name/description/category length caps, point-array shape and lat/lng range checks, server-recomputed distance — the request body's own `distanceMi`, if any, is ignored), then commits it straight to `main` with `status: "approved"`. Not restricted to any particular `sourceType` — a rider's own recorded ride, a pasted/imported route, or a declaratively-configured "route source" (see RydR's `plugins/route-exchange/route-exchange.js`, both its Submit screen and its Route Sources screen) can all use it; when a `sourceUrl` is given, a repeat of that same URL already in the catalog is rejected (so a misbehaving source can't spam duplicates). What makes this safe to expose despite skipping review is the `X-Admin-Token` header, checked against `ROUTE_MAPS_ADMIN_TOKEN` below — **never remove that check**, since CORS `*` + no auth would make it a fully public "write anything to the live catalog" endpoint.

Because every read hits the GitHub API too, **local dev (`npm run dev`) needs a working `GITHUB_TOKEN` and network access** — there's no offline fallback against a local `data/` copy.

## Environment variables

Copy `.env.example` to `.env` for local development, or set these in the Vercel project's Environment Variables for production:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes — everywhere, including local dev | A personal access token with write access to this repo. All reads and writes (browsing, `/admin`, uploads) go through the GitHub API. |
| `GITHUB_REPO` | No (defaults to this repo) | `owner/name` to read/write, if forked. |
| `GITHUB_BRANCH` | No (defaults to `main`) | Branch to read/commit against. |
| `ROUTE_MAPS_ADMIN_TOKEN` | No (only for the direct-add path) | A secret you choose, shared between this project's env vars and the token you type once into RydR's Route Sources screen. Required to call `POST /api/route-maps/direct-add`; unset means that endpoint is disabled outright (503) rather than falling open. Rotate it by changing the env var here and re-entering it in the app — treat a leak the same as any other bearer secret, since unlike `GOOGLE_MAPS_API_KEY`-style client-visible keys, this one grants unreviewed writes. |
