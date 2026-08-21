"use client";

import { useState } from "react";

export function InstallButton({
  downloadHref,
  entryUrl,
  manifestUrl,
}: {
  downloadHref: string;
  entryUrl: string;
  manifestUrl: string;
}) {
  const [copied, setCopied] = useState<"entry" | "manifest" | null>(null);

  async function copy(value: string, which: "entry" | "manifest") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable — nothing to fall back to here
    }
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <a href={downloadHref} className="btn justify-center">
        ⬇ Download bundle
      </a>

      <div className="text-xs text-[var(--text-muted)]">
        Or paste into Rydr&apos;s <strong>Settings ▸ Plugins ▸ Catalog source</strong>:
      </div>

      <button className="btn secondary justify-between text-xs" onClick={() => copy(manifestUrl, "manifest")}>
        <span className="truncate">{manifestUrl}</span>
        <span>{copied === "manifest" ? "Copied!" : "Copy"}</span>
      </button>

      <details className="text-xs text-[var(--text-muted)]">
        <summary className="cursor-pointer">Direct entry file URL</summary>
        <button
          className="btn secondary justify-between text-xs mt-2 w-full"
          onClick={() => copy(entryUrl, "entry")}
        >
          <span className="truncate">{entryUrl}</span>
          <span>{copied === "entry" ? "Copied!" : "Copy"}</span>
        </button>
      </details>
    </div>
  );
}
