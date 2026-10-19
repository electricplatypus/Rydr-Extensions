import { NextRequest, NextResponse } from "next/server";
import { GithubApiError } from "@/lib/github";
import { RouteValidationError, deleteEntry } from "@/lib/routeMaps";

// Auth is enforced by middleware.ts for the whole /api/route-maps/admin/*
// prefix (HTTP Basic Auth, ROUTE_MAPS_ADMIN_TOKEN) — nothing to check here.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  try {
    await deleteEntry(body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RouteValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof GithubApiError) {
      return NextResponse.json({ error: `GitHub error deleting "${body.id}": ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Unexpected error deleting the route." }, { status: 500 });
  }
}
