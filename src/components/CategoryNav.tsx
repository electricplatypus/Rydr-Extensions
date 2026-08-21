import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";

export function CategoryNav({ active }: { active?: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {CATEGORIES.map((c) => (
        <Link
          key={c.id}
          href={`/${c.id}`}
          className={`px-3 py-1.5 rounded-full text-sm border ${
            active === c.id
              ? "bg-[var(--accent)] text-black border-[var(--accent)] font-semibold"
              : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-white"
          }`}
        >
          {c.label}
        </Link>
      ))}
    </div>
  );
}
