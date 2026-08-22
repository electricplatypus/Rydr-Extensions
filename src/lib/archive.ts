import fs from "fs";
import path from "path";
import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { CategoryId } from "./types";
import { itemFilesDir } from "./items";

export async function bundleItemFiles(category: CategoryId, id: string): Promise<Uint8Array> {
  const dir = itemFilesDir(category, id);
  const zipWriter = new ZipWriter(new Uint8ArrayWriter());
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const filePath = path.join(dir, name);
      if (fs.statSync(filePath).isFile()) {
        await zipWriter.add(name, new Uint8ArrayReader(new Uint8Array(fs.readFileSync(filePath))));
      }
    }
  }
  return zipWriter.close();
}

export interface ExtractedFile {
  name: string;
  data: Uint8Array;
}

export async function extractZipArchive(buffer: Buffer): Promise<ExtractedFile[]> {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(buffer)));
  const entries = await reader.getEntries();
  const files: ExtractedFile[] = [];
  for (const entry of entries) {
    if (entry.directory || !entry.getData) continue;
    const data = await entry.getData(new Uint8ArrayWriter());
    files.push({ name: entry.filename.replace(/^\/+/, ""), data });
  }
  await reader.close();
  return files;
}
