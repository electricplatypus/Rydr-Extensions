import archiver from "archiver";
import fs from "fs";
import { CategoryId } from "./types";
import { itemFilesDir } from "./items";

export function bundleItemFiles(category: CategoryId, id: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dir = itemFilesDir(category, id);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    if (fs.existsSync(dir)) {
      archive.directory(dir, false);
    }
    archive.finalize();
  });
}
