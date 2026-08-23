import { CategoryId, ItemInput, MarketplaceItem, SortDir, SortField } from "./types";
import { commitFiles, getDownloadCounts, getIndex, listTreePaths, withRetry } from "./github";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function manifestPath(category: CategoryId, id: string): string {
  return `data/${category}/${id}/manifest.json`;
}

export function filesPrefix(category: CategoryId, id: string): string {
  return `data/${category}/${id}/files/`;
}

export async function listAllItems(): Promise<MarketplaceItem[]> {
  return getIndex();
}

export async function listItems(
  category: CategoryId,
  sort: SortField = "date",
  dir: SortDir = "desc"
): Promise<MarketplaceItem[]> {
  const items = (await getIndex()).filter((item) => item.category === category);

  return items.sort((a, b) => {
    let cmp = 0;
    if (sort === "date") cmp = a.createdAt.localeCompare(b.createdAt);
    else if (sort === "name") cmp = a.name.localeCompare(b.name);
    else if (sort === "downloads") cmp = a.downloads - b.downloads;
    return dir === "asc" ? cmp : -cmp;
  });
}

export async function readItem(category: CategoryId, id: string): Promise<MarketplaceItem | null> {
  const items = await getIndex();
  return items.find((item) => item.category === category && item.id === id) || null;
}

export interface ExtraItemFile {
  /** Path relative to data/<category>/<id>/, e.g. "files/my-plugin.js". */
  relativePath: string;
  content: Uint8Array | string;
}

/**
 * Creates an item, committing the index + manifest.json in one atomic
 * commit. Pass `extraFiles` (e.g. from an extracted zip upload) to land the
 * package's files in that same commit rather than a separate one.
 */
export async function createItem(
  category: CategoryId,
  input: ItemInput,
  extraFiles: ExtraItemFile[] = []
): Promise<MarketplaceItem> {
  const id = slugify(input.name);
  if (!id) throw new Error("Item name must contain at least one letter or number.");

  return withRetry(async () => {
    const index = await getIndex();
    if (index.some((item) => item.category === category && item.id === id)) {
      throw new Error(`An item with id "${id}" already exists in ${category}.`);
    }

    const now = new Date().toISOString();
    const item: MarketplaceItem = {
      id,
      category,
      name: input.name,
      description: input.description,
      author: input.author,
      version: input.version,
      icon: input.icon,
      repo: input.repo,
      entryFile: input.entryFile,
      rydrCategory: input.rydrCategory,
      colors: input.colors,
      createdAt: now,
      updatedAt: now,
      downloads: 0,
      tags: input.tags,
    };

    const nextIndex = [...index, item];
    await commitFiles(`Add ${item.name} to ${category}`, [
      { path: "data/index.json", content: JSON.stringify(nextIndex, null, 2) + "\n" },
      { path: manifestPath(category, id), content: JSON.stringify(item, null, 2) + "\n" },
      ...extraFiles.map((f) => ({ path: `data/${category}/${id}/${f.relativePath}`, content: f.content })),
    ]);
    return item;
  });
}

export async function updateItem(category: CategoryId, id: string, input: ItemInput): Promise<MarketplaceItem> {
  return withRetry(async () => {
    const index = await getIndex();
    const idx = index.findIndex((item) => item.category === category && item.id === id);
    if (idx === -1) throw new Error(`Item "${id}" not found in ${category}.`);

    const updated: MarketplaceItem = {
      ...index[idx],
      name: input.name,
      description: input.description,
      author: input.author,
      version: input.version,
      icon: input.icon,
      repo: input.repo,
      entryFile: input.entryFile,
      rydrCategory: input.rydrCategory,
      colors: input.colors,
      tags: input.tags,
      updatedAt: new Date().toISOString(),
    };

    const nextIndex = [...index];
    nextIndex[idx] = updated;

    await commitFiles(`Update ${updated.name} in ${category}`, [
      { path: "data/index.json", content: JSON.stringify(nextIndex, null, 2) + "\n" },
      { path: manifestPath(category, id), content: JSON.stringify(updated, null, 2) + "\n" },
    ]);
    return updated;
  });
}

export async function deleteItem(category: CategoryId, id: string): Promise<void> {
  return withRetry(async () => {
    const index = await getIndex();
    if (!index.some((item) => item.category === category && item.id === id)) {
      throw new Error(`Item "${id}" not found in ${category}.`);
    }

    const nextIndex = index.filter((item) => !(item.category === category && item.id === id));
    const paths = await listTreePaths(`data/${category}/${id}/`);

    await commitFiles(`Remove ${id} from ${category}`, [
      { path: "data/index.json", content: JSON.stringify(nextIndex, null, 2) + "\n" },
      ...paths.map((p) => ({ path: p.path, content: null })),
    ]);
  });
}

// Download counts live in their own data/downloads.json, deliberately
// decoupled from data/index.json and each item's manifest.json — a
// download shouldn't touch the same file a real edit does. vercel.json's
// ignoreCommand skips a rebuild for a commit that only changes this file,
// since counts are already read live via getIndex() on every request and
// never needed a redeploy to show up.
export async function incrementDownloads(category: CategoryId, id: string): Promise<void> {
  return withRetry(async () => {
    const counts = await getDownloadCounts();
    const key = `${category}/${id}`;
    const nextCounts = { ...counts, [key]: (counts[key] || 0) + 1 };

    await commitFiles(`Download: ${id}`, [
      { path: "data/downloads.json", content: JSON.stringify(nextCounts, null, 2) + "\n" },
    ]);
  });
}

export interface ItemFileInfo {
  name: string;
  size: number;
}

export async function listItemFiles(category: CategoryId, id: string): Promise<ItemFileInfo[]> {
  const prefix = filesPrefix(category, id);
  const paths = await listTreePaths(prefix);
  return paths.map((p) => ({ name: p.path.slice(prefix.length), size: p.size }));
}

const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

export function isSafeFilename(name: string): boolean {
  return SAFE_FILENAME.test(name) && name !== "." && name !== "..";
}

// Zip archives legitimately contain nested paths (assets/icon.png), unlike
// the single-file upload above — allow "/" but reject traversal and any
// segment that doesn't match the same safe character set.
export function isSafeArchivePath(archivePath: string): boolean {
  if (!archivePath || archivePath.startsWith("/") || archivePath.includes("..")) return false;
  return archivePath.split("/").every((segment) => isSafeFilename(segment));
}

export async function saveItemFile(category: CategoryId, id: string, filename: string, data: Buffer): Promise<void> {
  if (!isSafeFilename(filename)) throw new Error("Invalid filename.");
  await commitFiles(`Add ${filename} to ${category}/${id}`, [
    { path: `${filesPrefix(category, id)}${filename}`, content: new Uint8Array(data) },
  ]);
}

export async function deleteItemFile(category: CategoryId, id: string, filename: string): Promise<void> {
  if (!isSafeFilename(filename)) throw new Error("Invalid filename.");
  await commitFiles(`Remove ${filename} from ${category}/${id}`, [
    { path: `${filesPrefix(category, id)}${filename}`, content: null },
  ]);
}
