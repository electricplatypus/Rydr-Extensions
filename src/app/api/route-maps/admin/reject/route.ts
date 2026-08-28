import { NextRequest, NextResponse } from "next/server";
import { GithubApiError } from "@/lib/github";
import { rejectSubmission } from "@/lib/routeMaps";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { prNumber?: number; reason?: string };
  if (typeof body.prNumber !== "number") {
    return NextResponse.json({ error: "prNumber is required." }, { status: 400 });
  }
  try {
    await rejectSubmission(body.prNumber, body.reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GithubApiError) {
      return NextResponse.json({ error: `GitHub error rejecting PR #${body.prNumber}: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Unexpected error rejecting the route." }, { status: 500 });
  }
}
