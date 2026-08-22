import { NextRequest, NextResponse } from "next/server";
import { isCategoryId } from "@/lib/categories";
import { createItem, listItems } from "@/lib/items";
import { ItemInput, SortDir, SortField } from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: { category: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  const { searchParams } = new URL(req.url);
  const sort = (searchParams.get("sort") as SortField) || "date";
  const dir = (searchParams.get("dir") as SortDir) || "desc";
  return NextResponse.json(await listItems(params.category, sort, dir));
}

export async function POST(req: NextRequest, { params }: { params: { category: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  const body = (await req.json()) as ItemInput;
  if (!body.name || !body.description || !body.author || !body.version) {
    return NextResponse.json({ error: "name, description, author, and version are required" }, { status: 400 });
  }
  try {
    const item = await createItem(params.category, body);
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
