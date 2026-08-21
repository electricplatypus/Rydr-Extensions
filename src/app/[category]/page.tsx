import { notFound } from "next/navigation";
import { getCategory, isCategoryId } from "@/lib/categories";
import { listItems } from "@/lib/items";
import { SortDir, SortField } from "@/lib/types";
import { CategoryNav } from "@/components/CategoryNav";
import { ItemCard } from "@/components/ItemCard";
import { SortControls } from "@/components/SortControls";

export default function CategoryPage({
  params,
  searchParams,
}: {
  params: { category: string };
  searchParams: { sort?: string; dir?: string };
}) {
  if (!isCategoryId(params.category)) notFound();
  const category = getCategory(params.category)!;

  const sort = (searchParams.sort as SortField) || "date";
  const dir = (searchParams.dir as SortDir) || "desc";
  const items = listItems(category.id, sort, dir);

  return (
    <div>
      <CategoryNav active={category.id} />
      <h1 className="text-2xl font-bold mb-1">{category.label}</h1>
      <p className="text-[var(--text-muted)] mb-6">{category.description}</p>

      <SortControls categoryPath={`/${category.id}`} />

      {items.length === 0 ? (
        <p className="text-[var(--text-muted)] text-sm">No items in this category yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
