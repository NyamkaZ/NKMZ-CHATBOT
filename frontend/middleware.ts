import { NextResponse, type NextRequest } from "next/server";

/**
 * API calls are proxied to the backend by the rewrites in next.config.mjs.
 * The proxy does not pass the visitor's address on its own, so every visitor
 * would look like this server to the backend's per-address limits.
 * Forward the address Next recorded for the incoming request.
 */
export function middleware(request: NextRequest) {
  const address = request.headers.get("x-forwarded-for");
  if (!address) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", address);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
