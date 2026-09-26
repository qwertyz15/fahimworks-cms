import "server-only";
import { headers } from "next/headers";
import { isIP } from "node:net";

/**
 * Best-effort client IP. X-Forwarded-For is only trusted for the configured
 * number of proxy hops, so clients cannot spoof their IP to bypass rate limits.
 */
export function clientIpFrom(h: Headers): string {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  if (hops > 0) {
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const chain = xff.split(",").map((s) => s.trim()).filter(Boolean);
      const candidate = chain[Math.max(0, chain.length - hops)];
      if (candidate && isIP(candidate)) return candidate;
    }
    const real = h.get("x-real-ip");
    if (real && isIP(real)) return real;
  }
  return "unknown";
}

export async function clientIp(): Promise<string> {
  return clientIpFrom(await headers());
}
