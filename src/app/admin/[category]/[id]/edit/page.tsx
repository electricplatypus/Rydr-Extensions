import { notFound } from "next/navigation";
import { getCategory, isCategoryId } from "@/lib/categories";
import { listItemFiles, readItem } from "@/lib/items";
import { ItemForm } from "@/components/ItemForm";
import { FileManager } from "@/components/FileManager";

export default function EditItemPage({ params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) notFound();
  const category = getCategory(params.category)!;
  const item = readItem(category.id, params.id);
  if (!item) notFound();
  const files = listItemFiles(category.id, params.id);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Edit {item.name}</h1>
      <p className="text-[var(--text-muted)] mb-6">{category.label}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <ItemForm category={category.id} initial={item} />
        </div>
        <div>
          <FileManager category={category.id} id={item.id} initialFiles={files} />
        </div>
      </div>
    </div>
  );
}
