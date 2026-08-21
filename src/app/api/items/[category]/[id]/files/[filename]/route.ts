import { NextRequest, NextResponse } from "next/server";
import { isCategoryId } from "@/lib/categories";
import { deleteItemFile, listItemFiles } from "@/lib/items";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { category: string; id: string; filename: string } }
) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  try {
    deleteItemFile(params.category, params.id, decodeURIComponent(params.filename));
    return NextResponse.json(listItemFiles(params.category, params.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
