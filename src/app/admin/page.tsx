import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { listItems } from "@/lib/items";
import { DeleteItemButton } from "@/components/DeleteItemButton";

// GitHub is the database (see README) — every read must hit it live, so this
// page can't be statically prerendered at build time (that would also break
// builds wherever GITHUB_TOKEN isn't set at build time, e.g. Preview).
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const itemsByCategory = await Promise.all(CATEGORIES.map((category) => listItems(category.id, "date", "desc")));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/admin/upload" className="btn text-sm">
          📦 Add Extension
        </Link>
      </div>
      <p className="text-[var(--text-muted)] mb-8">Add, edit, or remove marketplace items in each category.</p>

      {CATEGORIES.map((category, i) => {
        const items = itemsByCategory[i];
        return (
          <div key={category.id} className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">{category.label}</h2>
              <Link href={`/admin/${category.id}/new`} className="btn text-sm">
                + New
              </Link>
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No items yet.</p>
            ) : (
              <div className="card divide-y divide-[var(--border-subtle)]">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{item.icon}</span>
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">
                          v{item.version} • {item.downloads} downloads
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link href={`/${category.id}/${item.id}`} className="btn secondary text-xs">
                        View
                      </Link>
                      <Link href={`/admin/${category.id}/${item.id}/edit`} className="btn secondary text-xs">
                        Edit
                      </Link>
                      <DeleteItemButton category={category.id} id={item.id} name={item.name} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
