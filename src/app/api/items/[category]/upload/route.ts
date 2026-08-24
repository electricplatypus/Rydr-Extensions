import { NextRequest, NextResponse } from "next/server";
import { isCategoryId } from "@/lib/categories";
import { extractZipArchive } from "@/lib/archive";
import { createItem, isSafeArchivePath } from "@/lib/items";
import { CategoryId, ItemInput, RydrCategory, isThemeCategory } from "@/lib/types";

interface ExtractedFile {
  name: string;
  data: Uint8Array;
}

function isMetadataFile(name: string): boolean {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base === "manifest.json" || /^[\w-]+-meta\.json$/i.test(base);
}

function pickEntryFile(names: string[], preferred?: string): string {
  if (preferred && names.includes(preferred)) return preferred;
  const jsAtRoot = names.find((n) => n.endsWith(".js") && !n.includes("/"));
  if (jsAtRoot) return jsAtRoot;
  const anyJs = names.find((n) => n.endsWith(".js"));
  if (anyJs) return anyJs;
  return names[0] || "";
}

function tryParseEmbeddedManifest(files: ExtractedFile[]): Record<string, unknown> {
  const candidate = files.find((f) => isMetadataFile(f.name));
  if (!candidate) return {};
  try {
    return JSON.parse(Buffer.from(candidate.data).toString("utf-8"));
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest, { params }: { params: { category: string } }) {
  if (!isCategoryId(params.category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  }
  const category = params.category as CategoryId;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No archive file provided." }, { status: 400 });
  }
  if (!/\.(zip|skill)$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .zip or .skill archives are accepted." }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Archive exceeds the 20 MB limit." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extracted: ExtractedFile[];
  try {
    extracted = await extractZipArchive(buffer);
  } catch {
    return NextResponse.json({ error: "Could not read that archive — is it a valid zip?" }, { status: 400 });
  }
  if (extracted.length === 0) {
    return NextResponse.json({ error: "Archive is empty." }, { status: 400 });
  }

  const embedded = tryParseEmbeddedManifest(extracted);
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  const name = field("name") || (typeof embedded.name === "string" ? embedded.name : "");
  const description = field("description") || (typeof embedded.description === "string" ? embedded.description : "");
  const author = field("author") || (typeof embedded.author === "string" ? embedded.author : "");
  const version = field("version") || (typeof embedded.version === "string" ? embedded.version : "1.0.0");
  const icon = field("icon") || (typeof embedded.icon === "string" ? embedded.icon : "◉");
  const repo = field("repo") || (typeof embedded.repo === "string" ? embedded.repo : undefined);
  const rydrCategory = (field("rydrCategory") ||
    (typeof embedded.category === "string" ? embedded.category : "tool")) as RydrCategory;
  const tagsField = field("tags");
  const tags = tagsField
    ? tagsField.split(",").map((t) => t.trim()).filter(Boolean)
    : Array.isArray(embedded.tags)
    ? (embedded.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  if (!name) {
    return NextResponse.json(
      { error: "A name is required (fill the Name field, or include one in an embedded manifest.json inside the archive)." },
      { status: 400 }
    );
  }

  // Metadata files describe the item — they aren't part of the shipped
  // package, so they don't get copied into files/.
  const packageFiles = extracted.filter((f) => !isMetadataFile(f.name) && isSafeArchivePath(f.name));
  const names = packageFiles.map((f) => f.name);

  const entryFile = isThemeCategory(category)
    ? field("entryFile") || names[0] || "theme.json"
    : pickEntryFile(names, field("entryFile") || undefined);

  let colors: Record<string, string> | undefined;
  if (isThemeCategory(category)) {
    if (embedded.colors && typeof embedded.colors === "object") {
      colors = embedded.colors as Record<string, string>;
    } else if (packageFiles.length === 1 && packageFiles[0].name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(Buffer.from(packageFiles[0].data).toString("utf-8"));
        colors = parsed.colors && typeof parsed.colors === "object" ? parsed.colors : parsed;
      } catch {
        colors = undefined;
      }
    }
  }

  const input: ItemInput = { name, description, author, version, icon, repo, entryFile, rydrCategory, colors, tags };
  const extraFiles = packageFiles.map((f) => ({ relativePath: `files/${f.name}`, content: f.data }));

  try {
    const item = await createItem(category, input, extraFiles);
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
