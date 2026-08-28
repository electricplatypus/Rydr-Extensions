// Shared between the client upload form (browser preview/auto-fill) and the
// server upload route (authoritative parsing on submit) so the two can't
// drift apart on what counts as an embedded manifest.

export interface ExtractedFileLike {
  name: string;
  data: Uint8Array;
}

export function isMetadataFile(name: string): boolean {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base === "manifest.json" || /^[\w-]+-meta\.json$/i.test(base);
}

export function parseEmbeddedManifest(files: ExtractedFileLike[]): Record<string, unknown> {
  const candidate = files.find((f) => isMetadataFile(f.name));
  if (!candidate) return {};
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(candidate.data));
  } catch {
    return {};
  }
}
