import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request";
import { getSettings } from "@/server/services/settings";

/** Shared plumbing for the read-only public API: kill switch, CORS allowlist, rate limit. */
export async function publicApiGuard(req: NextRequest): Promise<{ headers: Headers } | NextResponse> {
  const settings = await getSettings();
  const headers = new Headers({ Vary: "Origin", "X-Content-Type-Options": "nosniff" });
  const origin = req.headers.get("origin");
  if (origin && settings.allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  if (!settings.publicApiEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  }
  const limit = await rateLimit(`public:${clientIpFrom(req.headers)}`, RATE_LIMITS.publicApi);
  if (!limit.success) {
    headers.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
  }
  headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return { headers };
}

export async function publicOptions(req: NextRequest) {
  const guard = await publicApiGuard(req);
  if (guard instanceof NextResponse) return guard;
  return new NextResponse(null, { status: 204, headers: guard.headers });
}
