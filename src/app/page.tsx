import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { listAllItems } from "@/lib/items";
import { ItemCard } from "@/components/ItemCard";

export default async function HomePage() {
  const recent = (await listAllItems())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-3xl font-bold mb-2">Rydr Extensions Marketplace</h1>
        <p className="text-[var(--text-muted)] max-w-2xl">
          Themes, plugins, screensaver widgets, view extensions, and tools for the Rydr motorcycle
          dashboard — browse, install, and manage add-ons the same way you would in the VS Code
          Marketplace.
        </p>
      </div>

      <h2 className="text-lg font-semibold mb-3">Categories</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={`/${c.id}`} className="card p-5 hover:border-[var(--accent)] transition-colors">
            <div className="font-semibold mb-1">{c.label}</div>
            <div className="text-sm text-[var(--text-muted)]">{c.description}</div>
          </Link>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-3">Recently added</h2>
      {recent.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No items yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {recent.map((item) => (
            <ItemCard key={`${item.category}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
