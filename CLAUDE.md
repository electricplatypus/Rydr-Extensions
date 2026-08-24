# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Next.js (App Router) marketplace site for add-ons to the [Rydr](https://github.com/electricplatypus/rydr) motorcycle dashboard app: Track HUD themes, app themes, plugins, screensaver widgets, view extensions, and tools/utilities. Items are browsable, sortable (date/name/downloads), downloadable, and manageable via an open (no-auth) `/admin` CRUD.

## Commands

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

There is no test suite in this repo.

**Local dev requires a working `GITHUB_TOKEN` and network access** — see "GitHub is the database" below. Copy `.env.example` to `.env` and set `GITHUB_TOKEN` (a personal access token with write access to this repo) before running `npm run dev`.

## Architecture

### GitHub is the database

There is no filesystem storage and no separate database, in dev or in production — every read and write goes straight through the GitHub REST/Git Data API in `src/lib/github.ts`. This is deliberate: Vercel's serverless functions don't persist filesystem writes across requests or deploys, so a change only becomes real (visible to every visitor and to the live Rydr app's catalog fetch) the moment it lands as a commit.

- Each marketplace item is a folder under `data/<category>/<item-id>/`, holding `manifest.json` (the item's full metadata) and a `files/` directory with the item's actual package contents.
- `data/index.json` is a flat array of every item's full metadata, kept in sync with the per-item `manifest.json` files in the same commit on every write. Every listing/read (`getIndex()` in `src/lib/github.ts`) fetches this one file instead of enumerating a GitHub directory.
- `data/downloads.json` (a flat `"category/id" -> count` map) holds download counts, deliberately decoupled from `index.json`/`manifest.json` so a download doesn't land in the same commit as a real edit. `getIndex()` merges counts in on every read — no redeploy needed for a count to show up. `vercel.json`'s `ignoreCommand` skips a rebuild for commits that only touch this file.
- Writes go through `commitFiles()` in `src/lib/github.ts`: one atomic commit via the Git Data API (blob → tree → commit → ref update), so an index update and its manifest/files land together. Every mutation in `src/lib/items.ts` (`createItem`, `updateItem`, `deleteItem`, `incrementDownloads`, `saveItemFile`, `deleteItemFile`) is wrapped in `withRetry()`, which retries the whole read-modify-write cycle once if the branch moved underneath it (409/422 on ref update) — a plain "last write wins" race, not real optimistic locking.

### Layer structure

- `src/lib/github.ts` — the only module that talks to the GitHub API. Low-level primitives: `getIndex`, `getDownloadCounts`, `getFileBytes`, `listTreePaths`, `commitFiles`, `withRetry`.
- `src/lib/items.ts` — domain operations built on `github.ts`: CRUD for marketplace items, item-file management, slugifying names into ids, and the `isSafeFilename`/`isSafeArchivePath` path-traversal guards used before any commit that writes a user-supplied path.
- `src/lib/archive.ts` — zips a stored item's `files/` for download (`bundleItemFiles`) and unzips an uploaded `.zip`/`.skill` archive (`extractZipArchive`), via `@zip.js/zip.js`.
- `src/lib/rydrManifest.ts` — reshapes marketplace items into the manifest JSON the live Rydr app already parses (see next section).
- `src/lib/categories.ts` / `src/lib/types.ts` — the fixed list of `CategoryId`s and the `MarketplaceItem`/`ItemInput` shapes shared across lib, API routes, and components.
- `src/app/api/**` — thin Next.js route handlers: validate the category/request, call into `lib/items.ts` or `lib/rydrManifest.ts`, return JSON (or a zip stream for downloads). Keep business logic in `lib/`, not in routes.
- `src/app/**` (non-`api`) — the public marketplace pages (`/`, `/[category]`, `/[category]/[id]`) and the `/admin` CRUD pages, all reading through the same `lib/items.ts` functions server-side.

### Two item shapes

`MarketplaceItem` (`src/lib/types.ts`) covers two different kinds of payload, distinguished by `isThemeCategory(category)`:
- **Code-based items** (`plugins`, `screensavers`, `view-extensions`, `tools-utilities`): ship an `entryFile` (JS) under `files/`, tagged with a Rydr-side `rydrCategory`.
- **Theme items** (`app-themes`, `trackhud-themes`): ship a `colors` map instead of runnable code.

This split shows up again in `rydrManifest.ts` (code items become `plugins[]`, themes become `themes[]`/`trackHudThemes[]`) and in the upload route (`src/app/api/items/[category]/upload/route.ts`), which parses an uploaded archive differently depending on `isThemeCategory`.

### The Rydr catalog contract

`GET /api/manifest` (`src/app/api/manifest/route.ts` → `buildRydrManifest()` in `src/lib/rydrManifest.ts`) aggregates every item into the exact JSON shape Rydr's own **Settings ▸ Plugins ▸ Catalog source** parses (`RydRPlugins.refreshCatalog()` in the Rydr repo) — this URL is meant to be pasted into a live Rydr app. Code items get an `entryUrl` pointing at `raw.githubusercontent.com` (built by `entryRawUrl()`), which Rydr's plugin loader trusts directly. Changing this response shape is a cross-repo breaking change against Rydr, not just this app.

### Admin write paths

- `/admin` and `/admin/[category]/[id]/edit`, `/admin/[category]/new` — manual create/edit/delete through `ItemForm.tsx`, hitting the JSON `POST`/`PUT`/`DELETE` handlers under `src/app/api/items/[category]/[id]/route.ts` and `src/app/api/items/[category]/route.ts`.
- `/admin/upload` ("Add Extension") — uploads a `.zip`/`.skill` archive via `AddExtensionForm.tsx` to `src/app/api/items/[category]/upload/route.ts`, which extracts it, optionally auto-fills fields from an embedded `manifest.json`/`<id>-meta.json` at the archive root, and commits via the same `createItem()` used by the manual form.
- There is no authentication on `/admin` — treat any change here as immediately live and public.

## Conventions

- Path alias `@/*` maps to `src/*` (see `tsconfig.json`).
- Styling is Tailwind + a small set of CSS custom properties and utility classes defined in `src/app/globals.css` (`--bg-void`, `--bg-panel`, `--border-subtle`, `--text-primary`, `--text-muted`, `--accent`, and `.card`/`.btn`/`.input` classes) plus matching color tokens in `tailwind.config.ts` (`void`, `panel`, `border`, `accent`, `muted`). Prefer these existing tokens/classes over introducing new ad hoc colors.
- Category ids, labels, and descriptions are defined once in `src/lib/categories.ts` (`CATEGORIES`) — add a new category there (and to `CategoryId` in `types.ts`) rather than hardcoding category strings elsewhere.
- User-supplied filenames/archive paths must go through `isSafeFilename`/`isSafeArchivePath` (`src/lib/items.ts`) before being used in a commit path, to block traversal.
