"use client";

import { useRef, useState } from "react";
import { CategoryId } from "@/lib/types";

interface FileInfo {
  name: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileManager({
  category,
  id,
  initialFiles,
}: {
  category: CategoryId;
  id: string;
  initialFiles: FileInfo[];
}) {
  const [files, setFiles] = useState(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const body = new FormData();
    body.append("file", file);

    const res = await fetch(`/api/items/${category}/${id}/files`, { method: "POST", body });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Upload failed.");
    } else {
      setFiles(await res.json());
      if (inputRef.current) inputRef.current.value = "";
    }
    setUploading(false);
  }

  async function onDelete(name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const res = await fetch(`/api/items/${category}/${id}/files/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.ok) setFiles(await res.json());
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="font-semibold text-sm">Package files</div>

      {files.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No files uploaded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between text-xs">
              <span className="truncate">
                {f.name} <span className="text-[var(--text-muted)]">({formatSize(f.size)})</span>
              </span>
              <button type="button" className="btn secondary text-xs" onClick={() => onDelete(f.name)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onUpload} className="flex items-center gap-2">
        <input ref={inputRef} type="file" className="text-xs flex-1" />
        <button type="submit" className="btn text-xs" disabled={uploading}>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>
      {error && <div className="text-xs text-red-400">{error}</div>}
      <p className="text-xs text-[var(--text-muted)]">
        Upload the entry file (and any assets) here, then set &quot;Entry file&quot; above to match its filename.
      </p>
    </div>
  );
}
