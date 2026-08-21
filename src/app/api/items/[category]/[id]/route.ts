import { NextRequest, NextResponse } from "next/server";
import { isCategoryId } from "@/lib/categories";
import { deleteItem, readItem, updateItem } from "@/lib/items";
import { ItemInput } from "@/lib/types";

export async function GET(_req: NextRequest, { params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  const item = readItem(params.category, params.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function PUT(req: NextRequest, { params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  const body = (await req.json()) as ItemInput;
  try {
    const item = updateItem(params.category, params.id, body);
    return NextResponse.json(item);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  try {
    deleteItem(params.category, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
