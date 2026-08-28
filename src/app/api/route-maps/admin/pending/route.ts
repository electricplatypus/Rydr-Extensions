import { NextResponse } from "next/server";
import { listPendingSubmissions } from "@/lib/routeMaps";

// Same-origin only — no CORS headers, matching every other /api/items/*
// admin route in this app. Reached from the /admin/route-maps page itself,
// never from the RydR app directly.
export async function GET() {
  try {
    const pending = await listPendingSubmissions();
    return NextResponse.json(pending);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
