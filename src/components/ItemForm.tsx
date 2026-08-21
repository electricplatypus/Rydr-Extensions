"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryId, ItemInput, MarketplaceItem, RydrCategory, isThemeCategory } from "@/lib/types";

const RYDR_CATEGORIES: RydrCategory[] = ["display", "media", "performance", "navigation", "weather", "theme", "tool"];

// Matches Rydr's own custom-theme color roles exactly (js/dashboard.js
// deriveCustomThemeVars) so an installed marketplace theme drops straight
// into Rydr's existing theme-grid mechanism with no remapping.
const DEFAULT_APP_THEME_COLORS: Record<string, string> = {
  bg: "#0b0d12",
  panel: "#12151c",
  primary: "#ff6a00",
  secondary: "#7d8ba0",
  text: "#f4f6fa",
};

const DEFAULT_TRACKHUD_THEME_COLORS: Record<string, string> = {
  "hud-bg": "#0b0d12",
  "hud-text": "#ffffff",
  "hud-accent": "#ff6a00",
  "hud-gauge": "#7d8ba0",
};

export function ItemForm({
  category,
  initial,
}: {
  category: CategoryId;
  initial?: MarketplaceItem;
}) {
  const router = useRouter();
  const themeCategory = isThemeCategory(category);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [author, setAuthor] = useState(initial?.author || "");
  const [version, setVersion] = useState(initial?.version || "1.0.0");
  const [icon, setIcon] = useState(initial?.icon || "◉");
  const [repo, setRepo] = useState(initial?.repo || "");
  const [entryFile, setEntryFile] = useState(initial?.entryFile || `${category}.js`);
  const [rydrCategory, setRydrCategory] = useState<RydrCategory>(
    initial?.rydrCategory || (themeCategory ? "theme" : "display")
  );
  const [tags, setTags] = useState(initial?.tags.join(", ") || "");
  const [colors, setColors] = useState<Record<string, string>>(
    initial?.colors ||
      (category === "app-themes"
        ? DEFAULT_APP_THEME_COLORS
        : category === "trackhud-themes"
        ? DEFAULT_TRACKHUD_THEME_COLORS
        : {})
  );

  function updateColor(key: string, value: string) {
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const input: ItemInput = {
      name,
      description,
      author,
      version,
      icon,
      repo: repo || undefined,
      entryFile,
      rydrCategory,
      colors: themeCategory ? colors : undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    const url = initial ? `/api/items/${category}/${initial.id}` : `/api/items/${category}`;
    const method = initial ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Something went wrong.");
      setSubmitting(false);
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-xl">
      {error && <div className="text-sm text-red-400">{error}</div>}

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          required
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Author
          <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Version
          <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} required />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Icon (emoji)
          <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Repo (optional)
          <input className="input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/owner/repo" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Rydr category (emitted plugin manifest `category` field)
        <select className="input" value={rydrCategory} onChange={(e) => setRydrCategory(e.target.value as RydrCategory)}>
          {RYDR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {themeCategory ? (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">
            Colors {category === "trackhud-themes" ? "(self-applying — no native Rydr hook yet)" : ""}
          </div>
          {Object.entries(colors).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)] w-24">{key}</span>
              <input type="color" value={value} onChange={(e) => updateColor(key, e.target.value)} />
              <input className="input flex-1" value={value} onChange={(e) => updateColor(key, e.target.value)} />
            </div>
          ))}
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Entry file (inside files/)
          <input className="input" value={entryFile} onChange={(e) => setEntryFile(e.target.value)} required />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Tags (comma-separated)
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>

      <div className="flex gap-3 mt-2">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Saving…" : initial ? "Save changes" : "Create item"}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push("/admin")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
