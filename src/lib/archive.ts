import { ZipReader, ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { CategoryId } from "./types";
import { filesPrefix, listItemFiles } from "./items";
import { getFileBytes } from "./github";

export async function bundleItemFiles(category: CategoryId, id: string): Promise<Uint8Array> {
  const zipWriter = new ZipWriter(new Uint8ArrayWriter());
  const files = await listItemFiles(category, id);
  const prefix = filesPrefix(category, id);

  for (const file of files) {
    const data = await getFileBytes(`${prefix}${file.name}`);
    await zipWriter.add(file.name, new Uint8ArrayReader(data));
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
