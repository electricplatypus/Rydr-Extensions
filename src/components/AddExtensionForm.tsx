"use client";

import { useState } from "react";
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
  const [commitUrl, setCommitUrl] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .zip or .skill archive first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setCommitUrl(null);

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

    setCommitUrl(data.commit?.commitUrl || null);
    setSubmitting(false);
    setFile(null);
    setName("");
    setDescription("");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-xl">
      {error && <div className="text-sm text-red-400">{error}</div>}
      {commitUrl !== null && (
        <div className="text-sm text-green-400">
          Committed to GitHub —{" "}
          <a className="underline" href={commitUrl} target="_blank" rel="noreferrer">
            view commit
          </a>
          . It will appear in the marketplace once the next deployment finishes.
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
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <span className="text-xs text-[var(--text-muted)]">
          Include a <code>manifest.json</code> (or <code>&lt;id&gt;-meta.json</code>) at the archive root to
          auto-fill the fields below — anything you type here overrides it.
        </span>
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
