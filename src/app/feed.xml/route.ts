import { headers } from "next/headers";
import { listPublished } from "@/server/queries/public";
import { getSettings } from "@/server/services/settings";
import { writtenPostUrl } from "@/lib/timeline";

export const dynamic = "force-dynamic";

function esc(value: string) {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** RSS 2.0 feed of published content, linking to the original articles. */
export async function GET() {
  const settings = await getSettings();
  if (!settings.publicApiEnabled) return new Response("Not found", { status: 404 });

  const h = await headers();
  const self = `${process.env.AUTH_URL ?? `https://${h.get("host")}`}/feed.xml`;
  const site = settings.portfolioUrl ?? self;
  const { items } = await listPublished({ limit: 50 });

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${esc(settings.siteName)}</title>
<link>${esc(site)}</link>
<description>${esc(`Writing by ${settings.siteName}`)}</description>
<atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items
  .map(
    (i) => `<item>
<title>${esc(i.title)}</title>
<link>${esc(i.url ?? writtenPostUrl(i.slug))}</link>
<guid isPermaLink="false">${esc(i.id)}</guid>
<pubDate>${(i.publishDate ?? i.publishedAt ?? new Date()).toUTCString()}</pubDate>
${i.author ? `<dc:creator>${esc(i.author)}</dc:creator>` : ""}
<description>${esc(i.summary ?? i.description ?? "")}</description>
<category>${esc(i.type)}</category>
${i.tags.map((t) => `<category>${esc(t.name)}</category>`).join("")}
</item>`,
  )
  .join("\n")}
</channel>
</rss>`;

  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
