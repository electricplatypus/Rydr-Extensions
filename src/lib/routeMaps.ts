import { commitFilesToBranch, createBranch, getFileBytes, openPullRequest, withRetry } from "./github";
import { slugify } from "./items";

export type RouteCategory = "scenic" | "twisty" | "rally" | "touring" | "offroad";
export type RouteSourceType = "recorded" | "imported" | "external";
export type RouteStatus = "pending" | "approved";

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteMapEntry {
  id: string;
  name: string;
  description: string;
  category: RouteCategory;
  region: string;
  author: string;
  sourceType: RouteSourceType;
  sourceUrl: string;
  distanceMi: number;
  pointCount: number;
  entryFile: string;
  status: RouteStatus;
  tags: string[];
  createdAt: string;
  prUrl: string;
}

export interface RouteSubmissionInput {
  name: string;
  description?: string;
  category: string;
  region?: string;
  author?: string;
  sourceType?: string;
  sourceUrl?: string;
  tags?: unknown;
  points: unknown;
}

const ROUTE_CATEGORIES = new Set<RouteCategory>(["scenic", "twisty", "rally", "touring", "offroad"]);
const ROUTE_SOURCE_TYPES = new Set<RouteSourceType>(["recorded", "imported", "external"]);
const NAME_MAX = 100;
const DESC_MAX = 2000;
const REGION_MAX = 120;
const TAG_MAX = 40;
const TAGS_MAX_COUNT = 12;
const POINTS_MAX = 20000; // generous ceiling for a long multi-day route track

export class RouteValidationError extends Error {}

function cleanString(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > max ? s.slice(0, max) : s;
}

function cleanPoints(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) throw new RouteValidationError("points must be an array of {lat, lng}.");
  if (value.length < 2) throw new RouteValidationError("A route needs at least 2 points.");
  if (value.length > POINTS_MAX) throw new RouteValidationError(`A route can have at most ${POINTS_MAX} points.`);
  return value.map((p, i) => {
    const lat = typeof p?.lat === "number" ? p.lat : NaN;
    const lng = typeof p?.lng === "number" ? p.lng : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new RouteValidationError(`Point ${i} is not a valid {lat, lng}.`);
    }
    return { lat, lng };
  });
}

function haversineMiles(a: RoutePoint, b: RoutePoint): number {
  const R = 3958.8; // Earth radius, miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function totalDistanceMiles(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMiles(points[i - 1], points[i]);
  return Math.round(total * 10) / 10;
}

/** Validates + normalizes a raw submission body into everything submitRoute() needs. */
export function parseRouteSubmission(input: RouteSubmissionInput): { entry: Omit<RouteMapEntry, "entryFile" | "status" | "createdAt" | "prUrl">; points: RoutePoint[] } {
  const name = cleanString(input.name, NAME_MAX);
  if (!name) throw new RouteValidationError("A route name is required.");

  const category = ROUTE_CATEGORIES.has(input.category as RouteCategory) ? (input.category as RouteCategory) : "touring";
  const sourceType = ROUTE_SOURCE_TYPES.has(input.sourceType as RouteSourceType)
    ? (input.sourceType as RouteSourceType)
    : "recorded";

  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const tags = rawTags
    .filter((t): t is string => typeof t === "string")
    .map((t) => cleanString(t, TAG_MAX))
    .filter(Boolean)
    .slice(0, TAGS_MAX_COUNT);

  const points = cleanPoints(input.points);

  return {
    entry: {
      id: "", // filled in by submitRoute once the slug is known
      name,
      description: cleanString(input.description, DESC_MAX),
      category,
      region: cleanString(input.region, REGION_MAX),
      author: cleanString(input.author, NAME_MAX) || "Anonymous rider",
      sourceType,
      sourceUrl: cleanString(input.sourceUrl, 500),
      distanceMi: totalDistanceMiles(points),
      pointCount: points.length,
      tags,
    },
    points,
  };
}

/**
 * Opens a pull request adding a new route to data/route-maps/ — the one
 * write path in this app that never commits straight to main. A public,
 * unauthenticated submission form has to be reviewable before it's live;
 * see commitFilesToBranch/createBranch/openPullRequest in ./github.
 */
export async function submitRoute(input: RouteSubmissionInput): Promise<{ id: string; prUrl: string }> {
  const { entry, points } = parseRouteSubmission(input);

  return withRetry(async () => {
    const id = `${slugify(entry.name) || "route"}-${Date.now()}`;
    const branchName = `route-submission/${id}`;
    const entryFile = `data/route-maps/${id}/route.json`;

    const indexRaw: RouteMapEntry[] = await getFileBytes("data/route-maps/index.json")
      .then((bytes) => JSON.parse(Buffer.from(bytes).toString("utf-8")) as RouteMapEntry[])
      .catch(() => [] as RouteMapEntry[]);

    const fullEntry: RouteMapEntry = {
      ...entry,
      id,
      entryFile,
      status: "pending",
      createdAt: new Date().toISOString(),
      prUrl: "",
    };

    const nextIndex = [...indexRaw, fullEntry];

    await createBranch(branchName);
    await commitFilesToBranch(branchName, `Route submission: ${entry.name}`, [
      { path: entryFile, content: JSON.stringify({ points }, null, 2) + "\n" },
      { path: "data/route-maps/index.json", content: JSON.stringify(nextIndex, null, 2) + "\n" },
    ]);

    const pr = await openPullRequest({
      title: `Route submission: ${entry.name}`,
      body: [
        `**${entry.name}**${entry.region ? ` — ${entry.region}` : ""}`,
        "",
        entry.description || "_No description provided._",
        "",
        `- Category: ${entry.category}`,
        `- Distance: ${entry.distanceMi} mi (${entry.pointCount} points)`,
        `- Source: ${entry.sourceType}${entry.sourceUrl ? ` — ${entry.sourceUrl}` : ""}`,
        `- Submitted by: ${entry.author}`,
        entry.tags.length ? `- Tags: ${entry.tags.join(", ")}` : "",
        "",
        "Opened automatically by the RydR Route Exchange plugin. Merging this PR sets the",
        "route live for every rider — set `status` to `\"approved\"` in `data/route-maps/index.json`",
        "as part of the merge (or in a follow-up commit) once it's been reviewed.",
      ]
        .filter(Boolean)
        .join("\n"),
      head: branchName,
    });

    return { id, prUrl: pr.url };
  });
}
