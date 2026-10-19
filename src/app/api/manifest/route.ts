import { NextResponse } from "next/server";
import { buildRydrManifest } from "@/lib/rydrManifest";

// GitHub is the database (see README) — every read must hit it live, so this
// route can't be statically prerendered at build time (that would also break
// builds wherever GITHUB_TOKEN isn't set at build time, e.g. Preview).
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await buildRydrManifest());
}
