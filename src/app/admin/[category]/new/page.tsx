import { notFound } from "next/navigation";
import { getCategory, isCategoryId } from "@/lib/categories";
import { ItemForm } from "@/components/ItemForm";

export default function NewItemPage({ params }: { params: { category: string } }) {
  if (!isCategoryId(params.category)) notFound();
  const category = getCategory(params.category)!;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">New {category.label} item</h1>
      <p className="text-[var(--text-muted)] mb-6">{category.description}</p>
      <ItemForm category={category.id} />
    </div>
  );
}
