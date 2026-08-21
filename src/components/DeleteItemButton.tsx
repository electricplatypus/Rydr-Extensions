"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryId } from "@/lib/types";

export function DeleteItemButton({ category, id, name }: { category: CategoryId; id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    await fetch(`/api/items/${category}/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <button className="btn secondary text-xs" onClick={onDelete} disabled={busy}>
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
