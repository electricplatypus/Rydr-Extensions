export type CategoryId =
  | "trackhud-themes"
  | "app-themes"
  | "plugins"
  | "screensavers"
  | "view-extensions"
  | "tools-utilities";

export type RydrCategory =
  | "display"
  | "media"
  | "performance"
  | "navigation"
  | "weather"
  | "theme"
  | "tool";

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
}

export interface MarketplaceItem {
  id: string;
  category: CategoryId;
  name: string;
  description: string;
  author: string;
  version: string;
  icon: string;
  repo?: string;
  // Code-based items (plugins, screensavers, view-extensions, tools-utilities)
  entryFile: string;
  rydrCategory: RydrCategory;
  // Theme items (app-themes, trackhud-themes) ship color data instead of code
  colors?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  downloads: number;
  tags: string[];
}

export function isThemeCategory(category: CategoryId): boolean {
  return category === "app-themes" || category === "trackhud-themes";
}

export type SortField = "date" | "name" | "downloads";
export type SortDir = "asc" | "desc";

export interface ItemInput {
  name: string;
  description: string;
  author: string;
  version: string;
  icon: string;
  repo?: string;
  entryFile: string;
  rydrCategory: RydrCategory;
  colors?: Record<string, string>;
  tags: string[];
}
