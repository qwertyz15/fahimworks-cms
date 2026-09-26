import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Runs before every page/API request (Node.js runtime):
 *  1. Auth gate — /dashboard/** requires a valid session; signed-in users are
 *     sent away from /login and /register. Pages and actions re-check with
 *     requireAdmin() (defence in depth).
 *  2. Per-request CSP nonce so only our own scripts execute.
 */
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const signedIn = Boolean(req.auth?.user);

  if (pathname.startsWith("/dashboard") && !signedIn) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if ((pathname === "/login" || pathname === "/register") && signedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const https = (process.env.AUTH_URL ?? "").startsWith("https://");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
});

export const config = {
  matcher: ["/((?!api/public|api/health|feed.xml|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
