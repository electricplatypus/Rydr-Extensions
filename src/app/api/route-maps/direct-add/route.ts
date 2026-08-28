import { NextRequest, NextResponse } from "next/server";
import { GithubApiError } from "@/lib/github";
import { RouteValidationError, directAddRoute } from "@/lib/routeMaps";

// Called cross-origin from the RydR app's own domain, like route-maps/submit
// — but unlike that route, this one skips human review entirely, so it's
// gated by ROUTE_MAPS_ADMIN_TOKEN (set only in Vercel env vars, entered once
// by the rider into their own RydR app and never bundled into any client
// JS). Never widen this to accept unauthenticated requests — that would
// turn it into a public "write anything into the live catalog" endpoint.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const configuredToken = process.env.ROUTE_MAPS_ADMIN_TOKEN;
  if (!configuredToken) {
    return NextResponse.json(
      { error: "Direct-add is not configured on this server (ROUTE_MAPS_ADMIN_TOKEN is unset)." },
      { status: 503, headers: CORS_HEADERS }
    );
  }
  const providedToken = req.headers.get("x-admin-token") || "";
  if (providedToken !== configuredToken) {
    return NextResponse.json({ error: "Invalid or missing admin token." }, { status: 401, headers: CORS_HEADERS });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const result = await directAddRoute(body as never);
    return NextResponse.json(result, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    if (err instanceof RouteValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: CORS_HEADERS });
    }
    if (err instanceof GithubApiError) {
      return NextResponse.json({ error: "Could not add the route — try again shortly." }, { status: 502, headers: CORS_HEADERS });
    }
    return NextResponse.json({ error: "Unexpected error adding the route." }, { status: 500, headers: CORS_HEADERS });
  }
}
