import { NextRequest, NextResponse } from "next/server";
import { isCategoryId } from "@/lib/categories";
import { isSafeFilename, listItemFiles, readItem, saveItemFile } from "@/lib/items";

export async function GET(_req: NextRequest, { params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  if (!(await readItem(params.category, params.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await listItemFiles(params.category, params.id));
}

export async function POST(req: NextRequest, { params }: { params: { category: string; id: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  if (!(await readItem(params.category, params.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!isSafeFilename(file.name)) {
    return NextResponse.json({ error: "Filename must be letters, numbers, dots, dashes, or underscores only." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File exceeds the 5 MB limit." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await saveItemFile(params.category, params.id, file.name, buffer);

  return NextResponse.json(await listItemFiles(params.category, params.id), { status: 201 });
}
