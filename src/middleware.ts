import { NextRequest, NextResponse } from "next/server";

/**
 * Gates the entire /admin section (route approvals, item CRUD, uploads) —
 * previously wide open to anyone who found the URL, with no login of any
 * kind (see the removed "Nothing here needs a GitHub login" copy on the
 * route-maps admin page). A single shared password, checked via standard
 * HTTP Basic Auth so it protects full page loads (not just fetch() calls,
 * which could carry a custom header) with zero new UI: the browser's own
 * native login prompt handles it.
 *
 * Reuses ROUTE_MAPS_ADMIN_TOKEN as the password rather than adding a new
 * env var — it was already the "admin" credential for this catalog (see
 * the direct-add route), just narrowly scoped to one endpoint until now.
 *
 * Deliberately excludes the always-public routes below: /api/route-maps/
 * submit (unauthenticated-by-design submission form) and /direct-add
 * (its own existing X-Admin-Token header check, called cross-origin from
 * the RydR app itself — a second auth scheme here would just break it),
 * plus /api/manifest and every plain GET under /api/items (the RydR
 * Marketplace browses those with no login).
 */

const ALWAYS_PUBLIC_PREFIXES = ["/api/route-maps/direct-add", "/api/route-maps/submit", "/api/manifest"];

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Rydr-Extensions Admin"' },
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (ALWAYS_PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/route-maps/admin");
  const isItemsWrite = pathname.startsWith("/api/items") && req.method !== "GET";

  if (!isAdminPage && !isAdminApi && !isItemsWrite) {
    return NextResponse.next();
  }

  const password = process.env.ROUTE_MAPS_ADMIN_TOKEN;
  if (!password) return unauthorized();

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Basic ")) return unauthorized();

  let decoded = "";
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return unauthorized();
  }
  const providedPassword = decoded.slice(decoded.indexOf(":") + 1);
  if (providedPassword !== password) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/route-maps/admin/:path*", "/api/items/:path*"],
};
