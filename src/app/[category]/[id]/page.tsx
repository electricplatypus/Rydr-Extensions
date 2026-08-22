import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategory, isCategoryId } from "@/lib/categories";
import { readItem } from "@/lib/items";
import { entryRawUrl } from "@/lib/rydrManifest";
import { isThemeCategory } from "@/lib/types";
import { InstallButton } from "@/components/InstallButton";

export default async function ItemDetailPage({ params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) notFound();
  const category = getCategory(params.category)!;
  const item = await readItem(category.id, params.id);
  if (!item) notFound();

  const host = headers().get("host");
  const proto = host?.includes("localhost") ? "http" : "https";
  const siteUrl = host ? `${proto}://${host}` : "";
  const manifestUrl = `${siteUrl}/api/manifest`;
  const downloadHref = `/api/items/${category.id}/${item.id}/download`;
  const entryUrl = entryRawUrl(item);
  const themeItem = isThemeCategory(category.id);

  return (
    <div>
      <Link href={`/${category.id}`} className="text-sm text-[var(--text-muted)] hover:text-white">
        ← {category.label}
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-4 mb-4">
            <div className="text-4xl">{item.icon || "◉"}</div>
            <div>
              <h1 className="text-2xl font-bold">{item.name}</h1>
              <div className="text-sm text-[var(--text-muted)]">
                v{item.version} • by {item.author}
              </div>
            </div>
          </div>

          <p className="mb-6">{item.description}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 text-sm">
            <div className="card p-3">
              <div className="text-[var(--text-muted)] text-xs">Added</div>
              <div>{new Date(item.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="card p-3">
              <div className="text-[var(--text-muted)] text-xs">Updated</div>
              <div>{new Date(item.updatedAt).toLocaleDateString()}</div>
            </div>
            <div className="card p-3">
              <div className="text-[var(--text-muted)] text-xs">Downloads</div>
              <div>{item.downloads}</div>
            </div>
            <div className="card p-3">
              <div className="text-[var(--text-muted)] text-xs">Rydr category</div>
              <div>{item.rydrCategory}</div>
            </div>
          </div>

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {item.tags.map((tag) => (
                <span key={tag} className="px-2 py-1 rounded-full text-xs border border-[var(--border-subtle)] text-[var(--text-muted)]">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {themeItem && item.colors && (
            <div className="card p-4 mb-6">
              <div className="font-semibold mb-3">Colors</div>
              <div className="flex flex-wrap gap-3">
                {Object.entries(item.colors).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-full border border-[var(--border-subtle)]" style={{ background: value }} />
                    <span className="text-[var(--text-muted)]">{key}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {item.repo && (
            <div className="text-xs text-[var(--text-muted)]">
              Source: <span className="text-white">{item.repo}</span>
            </div>
          )}
        </div>

        <div>
          <InstallButton downloadHref={downloadHref} entryUrl={entryUrl} manifestUrl={manifestUrl} />
        </div>
      </div>
    </div>
  );
}
