import { CATEGORIES } from "@/lib/categories";
import { AddExtensionForm } from "@/components/AddExtensionForm";

export default function AddExtensionPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Add Extension</h1>
      <p className="text-[var(--text-muted)] mb-6">
        Upload a .zip or .skill archive to publish a plugin, theme, screensaver widget, view extension, or tool.
        This commits the extracted files and a manifest straight to the Rydr Extensions GitHub repo — the right
        way to publish here, since the deployed app&apos;s own filesystem doesn&apos;t persist writes.
      </p>
      <AddExtensionForm categories={CATEGORIES} />
    </div>
  );
}
