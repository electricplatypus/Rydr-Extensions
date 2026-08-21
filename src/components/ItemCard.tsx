import Link from "next/link";
import { MarketplaceItem } from "@/lib/types";

export function ItemCard({ item }: { item: MarketplaceItem }) {
  return (
    <Link
      href={`/${item.category}/${item.id}`}
      className="card p-4 flex flex-col gap-2 hover:border-[var(--accent)] transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="text-2xl">{item.icon || "◉"}</div>
        <div>
          <div className="font-semibold">{item.name}</div>
          <div className="text-xs text-[var(--text-muted)]">
            v{item.version} • {item.author}
          </div>
        </div>
      </div>
      <p className="text-sm text-[var(--text-muted)] line-clamp-2">{item.description}</p>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mt-auto pt-2">
        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
        <span>⬇ {item.downloads}</span>
      </div>
    </Link>
  );
}
