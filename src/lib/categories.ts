import { Category, CategoryId } from "./types";

export const CATEGORIES: Category[] = [
  {
    id: "trackhud-themes",
    label: "Track HUD Themes",
    description: "Color themes for the full-screen Track HUD telemetry view.",
  },
  {
    id: "app-themes",
    label: "App Themes",
    description: "Color themes for the main Rydr dashboard.",
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Dashboard card plugins with live telemetry, media, and more.",
  },
  {
    id: "screensavers",
    label: "Screensaver Widgets",
    description: "Compact widgets that appear in the OLED screensaver.",
  },
  {
    id: "view-extensions",
    label: "View Extensions",
    description: "Custom full-screen app views with their own menu entry.",
  },
  {
    id: "tools-utilities",
    label: "Tools & Utilities",
    description: "Rider tools and utilities that don't fit elsewhere.",
  },
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function isCategoryId(id: string): id is CategoryId {
  return CATEGORIES.some((c) => c.id === id);
}
