import fs from "fs";
import path from "path";
import { CategoryId, ItemInput, MarketplaceItem, SortDir, SortField } from "./types";

const DATA_ROOT = path.join(process.cwd(), "data");

function categoryDir(category: CategoryId): string {
  return path.join(DATA_ROOT, category);
}

function itemDir(category: CategoryId, id: string): string {
  return path.join(categoryDir(category), id);
}

function manifestPath(category: CategoryId, id: string): string {
  return path.join(itemDir(category, id), "manifest.json");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function listItems(
  category: CategoryId,
  sort: SortField = "date",
  dir: SortDir = "desc"
): MarketplaceItem[] {
  const dirPath = categoryDir(category);
  if (!fs.existsSync(dirPath)) return [];

  const items = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readItem(category, entry.name))
    .filter((item): item is MarketplaceItem => item !== null);

  const sorted = items.sort((a, b) => {
    let cmp = 0;
    if (sort === "date") cmp = a.createdAt.localeCompare(b.createdAt);
    else if (sort === "name") cmp = a.name.localeCompare(b.name);
    else if (sort === "downloads") cmp = a.downloads - b.downloads;
    return dir === "asc" ? cmp : -cmp;
  });

  return sorted;
}

export function listAllItems(): MarketplaceItem[] {
  if (!fs.existsSync(DATA_ROOT)) return [];
  return fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => listItems(entry.name as CategoryId));
}

export function readItem(category: CategoryId, id: string): MarketplaceItem | null {
  const file = manifestPath(category, id);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw) as MarketplaceItem;
  } catch {
    return null;
  }
}

export function createItem(category: CategoryId, input: ItemInput): MarketplaceItem {
  const id = slugify(input.name);
  if (!id) throw new Error("Item name must contain at least one letter or number.");
  if (readItem(category, id)) throw new Error(`An item with id "${id}" already exists in ${category}.`);

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

  const dir = itemDir(category, id);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  fs.writeFileSync(manifestPath(category, id), JSON.stringify(item, null, 2) + "\n");
  return item;
}

export function updateItem(
  category: CategoryId,
  id: string,
  input: ItemInput
): MarketplaceItem {
  const existing = readItem(category, id);
  if (!existing) throw new Error(`Item "${id}" not found in ${category}.`);

  const updated: MarketplaceItem = {
    ...existing,
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

  fs.writeFileSync(manifestPath(category, id), JSON.stringify(updated, null, 2) + "\n");
  return updated;
}

export function deleteItem(category: CategoryId, id: string): void {
  const dir = itemDir(category, id);
  if (!fs.existsSync(dir)) throw new Error(`Item "${id}" not found in ${category}.`);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function incrementDownloads(category: CategoryId, id: string): MarketplaceItem | null {
  const existing = readItem(category, id);
  if (!existing) return null;
  const updated = { ...existing, downloads: existing.downloads + 1 };
  fs.writeFileSync(manifestPath(category, id), JSON.stringify(updated, null, 2) + "\n");
  return updated;
}

export function itemFilesDir(category: CategoryId, id: string): string {
  return path.join(itemDir(category, id), "files");
}
