import { notFound } from "next/navigation";
import { getCategory, isCategoryId } from "@/lib/categories";
import { readItem } from "@/lib/items";
import { ItemForm } from "@/components/ItemForm";

export default function EditItemPage({ params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) notFound();
  const category = getCategory(params.category)!;
  const item = readItem(category.id, params.id);
  if (!item) notFound();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Edit {item.name}</h1>
      <p className="text-[var(--text-muted)] mb-6">{category.label}</p>
      <ItemForm category={category.id} initial={item} />
    </div>
  );
}
