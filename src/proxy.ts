import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isTimelineHost } from "@/lib/timeline";

/**
 * Runs before every page/API request (Node.js runtime):
 *  1. Timeline host (TIMELINE_HOST, e.g. timeline.fahimworks.dev) serves ONLY
 *     the public timeline: "/" shows it, everything else is 404 — the login
 *     page and dashboard are not reachable on that domain.
 *  2. Auth gate — /dashboard/** requires a valid session; signed-in users are
 *     sent away from /login and /register. Pages and actions re-check with
 *     requireAdmin() (defence in depth).
 *  3. Per-request CSP nonce so only our own scripts execute.
 */

/** Origin of an env URL, or "" (used to allow direct browser uploads to / images from object storage). */
function envOrigin(name: string): string {
  try {
    return process.env[name] ? new URL(process.env[name]!).origin : "";
  } catch {
    return "";
  }
}

function withCsp(req: NextRequest, rewriteTo?: URL) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const https = (process.env.AUTH_URL ?? "").startsWith("https://");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' https: data: blob:${envOrigin("S3_PUBLIC_URL") ? ` ${envOrigin("S3_PUBLIC_URL")}` : ""}`,
    "font-src 'self' data:",
    // Uploaded Notebook videos play from object storage.
    `media-src 'self' https: blob:${envOrigin("S3_PUBLIC_URL") ? ` ${envOrigin("S3_PUBLIC_URL")}` : ""}`,
    // Notebook images are PUT straight to the storage endpoint (presigned URLs).
    `connect-src 'self'${envOrigin("S3_ENDPOINT") ? ` ${envOrigin("S3_ENDPOINT")}` : ""}${dev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    // Only privacy-friendly video players may be embedded (Notebook video embeds).
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request: { headers: requestHeaders } })
    : NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

/** Only the timeline (and Next's own assets, which bypass this file) on the timeline host. */
function timelineHostResponse(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/") return withCsp(req, new URL("/timeline", req.url));
  if (pathname === "/timeline") return NextResponse.redirect(new URL("/", req.url), 308);
  // Notebook articles: /p/<slug> is canonical on this host.
  const article = pathname.match(/^\/p\/([a-z0-9-]{1,120})\/?$/);
  if (article) return withCsp(req, new URL(`/timeline/p/${article[1]}`, req.url));
  const longForm = pathname.match(/^\/timeline\/p\/([a-z0-9-]{1,120})\/?$/);
  if (longForm) return NextResponse.redirect(new URL(`/p/${longForm[1]}`, req.url), 308);
  if (pathname.startsWith("/_next/")) return withCsp(req);
  return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

const authProxy = auth((req) => {
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
  return withCsp(req);
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  // Decide on the real Host header, before Auth.js rewrites the URL to AUTH_URL.
  if (isTimelineHost(req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return timelineHostResponse(req);
  }
  return authProxy(req, event as never);
}

export const config = {
  matcher: ["/((?!api/public|api/health|feed.xml|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt).*)"],
};
