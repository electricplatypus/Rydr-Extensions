import { NextResponse } from "next/server";
import { buildRydrManifest } from "@/lib/rydrManifest";

export async function GET() {
  return NextResponse.json(await buildRydrManifest());
}
