import { listAllItems } from "./items";
import { MarketplaceItem } from "./types";

const REPO_RAW_BASE =
  process.env.RYDR_EXTENSIONS_RAW_BASE ||
  "https://raw.githubusercontent.com/electricplatypus/rydr-extensions/main";

export interface RydrPluginManifestEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  category: string;
  enabled: boolean;
  entryUrl: string;
  repo?: string;
}

export function entryRawUrl(item: MarketplaceItem): string {
  return `${REPO_RAW_BASE}/data/${item.category}/${item.id}/files/${item.entryFile}`;
}

export function toRydrPluginEntry(item: MarketplaceItem): RydrPluginManifestEntry {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    version: item.version,
    icon: item.icon,
    category: item.rydrCategory,
    enabled: true,
    entryUrl: entryRawUrl(item),
    repo: item.repo,
  };
}

/**
 * Aggregates every marketplace item into the manifest shape Rydr's
 * Settings > Plugins > Catalog source already parses (RydRPlugins.refreshCatalog),
 * extended with `themes`/`trackHudThemes` color-data arrays for the two
 * categories that have no JS entry file to run.
 */
export async function buildRydrManifest() {
  const items = await listAllItems();

  const plugins = items
    .filter((item) => item.category !== "app-themes" && item.category !== "trackhud-themes")
    .map(toRydrPluginEntry);

  const themes = items
    .filter((item) => item.category === "app-themes")
    .map((item) => ({
      id: item.id,
      name: item.name,
      source: "marketplace",
      repo: item.repo,
      colors: item.colors || {},
    }));

  const trackHudThemes = items
    .filter((item) => item.category === "trackhud-themes")
    .map((item) => ({
      id: item.id,
      name: item.name,
      source: "marketplace",
      repo: item.repo,
      colors: item.colors || {},
    }));

  return { plugins, themes, trackHudThemes };
}
