"use client";

import Link from "next/link";
import { useState } from "react";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { parseEmbeddedManifest } from "@/lib/manifest";
import { Category, CategoryId, RydrCategory, isThemeCategory } from "@/lib/types";

const RYDR_CATEGORIES: RydrCategory[] = ["display", "media", "performance", "navigation", "weather", "theme", "tool"];

export function AddExtensionForm({ categories }: { categories: Category[] }) {
  const [category, setCategory] = useState<CategoryId>(categories[0].id);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [icon, setIcon] = useState("◉");
  const [repo, setRepo] = useState("");
  const [rydrCategory, setRydrCategory] = useState<RydrCategory>("tool");
  const [tags, setTags] = useState("");
  const [entryFile, setEntryFile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{ category: CategoryId; id: string } | null>(null);
  const [autoFilledFrom, setAutoFilledFrom] = useState<string | null>(null);

  async function onFileSelected(selected: File | null) {
    setFile(selected);
    setAutoFilledFrom(null);
    if (!selected) return;

    let embedded: Record<string, unknown>;
    try {
      const buffer = new Uint8Array(await selected.arrayBuffer());
      const reader = new ZipReader(new Uint8ArrayReader(buffer));
      const entries = await reader.getEntries();
      const files = [];
      for (const entry of entries) {
        if (entry.directory || !entry.getData) continue;
        const data = await entry.getData(new Uint8ArrayWriter());
        files.push({ name: entry.filename.replace(/^\/+/, ""), data });
      }
      await reader.close();
      embedded = parseEmbeddedManifest(files);
    } catch {
      return; // Not a readable zip yet — the server still parses it on submit.
    }
    if (Object.keys(embedded).length === 0) return;

    if (typeof embedded.name === "string") setName(embedded.name);
    if (typeof embedded.description === "string") setDescription(embedded.description);
    if (typeof embedded.author === "string") setAuthor(embedded.author);
    if (typeof embedded.version === "string") setVersion(embedded.version);
    if (typeof embedded.icon === "string") setIcon(embedded.icon);
    if (typeof embedded.repo === "string") setRepo(embedded.repo);
    if (typeof embedded.category === "string") setRydrCategory(embedded.category as RydrCategory);
    if (typeof embedded.entryFile === "string") setEntryFile(embedded.entryFile);
    if (Array.isArray(embedded.tags)) {
      setTags(embedded.tags.filter((t): t is string => typeof t === "string").join(", "));
    }
    setAutoFilledFrom(selected.name);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .zip or .skill archive first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setPublished(null);

    const body = new FormData();
    body.append("file", file);
    body.append("name", name);
    body.append("description", description);
    body.append("author", author);
    body.append("version", version);
    body.append("icon", icon);
    if (repo) body.append("repo", repo);
    body.append("rydrCategory", rydrCategory);
    body.append("tags", tags);
    if (entryFile) body.append("entryFile", entryFile);

    const res = await fetch(`/api/items/${category}/upload`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error || "Upload failed.");
      setSubmitting(false);
      return;
    }

    setPublished({ category, id: data.id });
    setSubmitting(false);
    setFile(null);
    setAutoFilledFrom(null);
    setName("");
    setDescription("");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-xl">
      {error && <div className="text-sm text-red-400">{error}</div>}
      {published && (
        <div className="text-sm text-green-400">
          Published —{" "}
          <Link className="underline" href={`/${published.category}/${published.id}`}>
            view it in the marketplace
          </Link>
          .
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Category
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value as CategoryId)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Archive (.zip or .skill)
        <input
          type="file"
          accept=".zip,.skill"
          className="text-sm"
          onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
        />
        <span className="text-xs text-[var(--text-muted)]">
          Include a <code>manifest.json</code> (or <code>&lt;id&gt;-meta.json</code>) anywhere in the archive to
          auto-fill the fields below — anything you change afterward overrides it.
        </span>
        {autoFilledFrom && (
          <span className="text-xs text-green-400">Auto-filled from {autoFilledFrom}.</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Author
          <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Version
          <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} />
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
        Rydr category (emitted plugin manifest &quot;category&quot; field)
        <select className="input" value={rydrCategory} onChange={(e) => setRydrCategory(e.target.value as RydrCategory)}>
          {RYDR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {!isThemeCategory(category) && (
        <label className="flex flex-col gap-1 text-sm">
          Entry file (optional — auto-detected from the archive if left blank)
          <input className="input" value={entryFile} onChange={(e) => setEntryFile(e.target.value)} placeholder="my-plugin.js" />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Tags (comma-separated)
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>

      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? "Uploading…" : "Add extension"}
      </button>
    </form>
  );
}
