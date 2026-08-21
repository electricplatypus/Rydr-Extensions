import { NextRequest, NextResponse } from "next/server";
import { isCategoryId } from "@/lib/categories";
import { incrementDownloads, readItem } from "@/lib/items";
import { bundleItemFiles } from "@/lib/archive";

export async function GET(_req: NextRequest, { params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  const item = readItem(params.category, params.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const zip = await bundleItemFiles(params.category, params.id);
  incrementDownloads(params.category, params.id);

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${item.id}.zip"`,
    },
  });
}
