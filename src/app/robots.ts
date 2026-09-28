import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isTimelineHost } from "@/lib/timeline";
import { getSettings } from "@/server/services/settings";

/** The dashboard is never indexed. The timeline host allows crawling only when the timeline is set to "public". */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  if (isTimelineHost(h.get("x-forwarded-host") ?? h.get("host"))) {
    const s = await getSettings();
    if (s.timelineEnabled && s.timelineIndexable) return { rules: [{ userAgent: "*", allow: "/" }] };
  }
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
