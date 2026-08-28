import { NextRequest, NextResponse } from "next/server";
import { GithubApiError } from "@/lib/github";
import { RouteValidationError, approveSubmission } from "@/lib/routeMaps";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { prNumber?: number };
  if (typeof body.prNumber !== "number") {
    return NextResponse.json({ error: "prNumber is required." }, { status: 400 });
  }
  try {
    const entry = await approveSubmission(body.prNumber);
    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof RouteValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof GithubApiError) {
      return NextResponse.json({ error: `GitHub error approving PR #${body.prNumber}: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: "Unexpected error approving the route." }, { status: 500 });
  }
}
