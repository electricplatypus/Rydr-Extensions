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
 * categories that have no JS entry file to run, and `studioAddons` (Ride Film
 * Studio add-on packs, JSON data read by the studio's add-on store).
 */
export async function buildRydrManifest() {
  const items = await listAllItems();

  // studio-addons are JSON add-on packs for Ride Film Studio, not scripts: never offer them as plugins
  const plugins = items
    .filter((item) => item.category !== "app-themes" && item.category !== "trackhud-themes" && item.category !== "studio-addons")
    .map(toRydrPluginEntry);

  const studioAddons = items
    .filter((item) => item.category === "studio-addons")
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      version: item.version,
      license: item.license,
      addonCount: item.addonCount,
      kinds: item.kinds,
      url: entryRawUrl(item),
    }));

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

  return { plugins, themes, trackHudThemes, studioAddons };
}
