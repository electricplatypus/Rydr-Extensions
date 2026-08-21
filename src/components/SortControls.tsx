"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { SortDir, SortField } from "@/lib/types";

const FIELDS: { value: SortField; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "name", label: "Name" },
  { value: "downloads", label: "Downloads" },
];

export function SortControls({ categoryPath }: { categoryPath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sort = (searchParams.get("sort") as SortField) || "date";
  const dir = (searchParams.get("dir") as SortDir) || "desc";

  function update(nextSort: SortField, nextDir: SortDir) {
    router.push(`${categoryPath}?sort=${nextSort}&dir=${nextDir}`);
  }

  return (
    <div className="flex items-center gap-2 mb-6 text-sm">
      <span className="text-[var(--text-muted)]">Sort by:</span>
      {FIELDS.map((f) => (
        <button
          key={f.value}
          onClick={() => update(f.value, sort === f.value && dir === "desc" ? "asc" : "desc")}
          className={`px-3 py-1 rounded-md border ${
            sort === f.value
              ? "border-[var(--accent)] text-white"
              : "border-[var(--border-subtle)] text-[var(--text-muted)]"
          }`}
        >
          {f.label} {sort === f.value ? (dir === "desc" ? "↓" : "↑") : ""}
        </button>
      ))}
    </div>
  );
}
