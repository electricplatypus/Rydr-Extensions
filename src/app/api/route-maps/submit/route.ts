import { NextRequest, NextResponse } from "next/server";
import { GithubApiError } from "@/lib/github";
import { RouteValidationError, submitRoute } from "@/lib/routeMaps";

// Called cross-origin from the RydR app's own domain (a different Vercel
// project), unlike every other route in this app — CORS headers are load
// bearing here, not copy-paste boilerplate.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const result = await submitRoute(body as never);
    return NextResponse.json(result, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    if (err instanceof RouteValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: CORS_HEADERS });
    }
    if (err instanceof GithubApiError) {
      return NextResponse.json({ error: "Could not open the submission — try again shortly." }, { status: 502, headers: CORS_HEADERS });
    }
    return NextResponse.json({ error: "Unexpected error submitting the route." }, { status: 500, headers: CORS_HEADERS });
  }
}
