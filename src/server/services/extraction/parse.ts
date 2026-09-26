import * as cheerio from "cheerio";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";
import { absoluteUrl } from "@/lib/url";

/**
 * Pure HTML → structured document extraction. No network, no database.
 * Kept free of `server-only` so it can be unit tested directly.
 */

export interface ExtractedDocument {
  title: string | null;
  description: string | null;
  author: string | null;
  publishDate: Date | null;
  siteName: string | null;
  language: string | null;
  canonicalUrl: string | null;
  thumbnail: string | null;
  images: string[];
  tags: string[];
  contentHtml: string;
  contentText: string;
  wordCount: number;
  readingMinutes: number;
  linkDensity: number;
  metadata: Record<string, unknown>;
}

export interface MeaningfulCheck {
  ok: boolean;
  reason?: string;
}

const ARTICLE_TYPES = new Set([
  "article",
  "blogposting",
  "newsarticle",
  "techarticle",
  "scholarlyarticle",
  "howto",
  "report",
  "socialmediaposting",
  "creativework",
  "softwaresourcecode",
  "learningresource",
]);

type JsonLd = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const v = value.replace(/\s+/g, " ").trim();
    return v || null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  const v = text(value);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  // Reject obviously bogus dates (before the web, or far future).
  if (d.getFullYear() < 1991 || d.getTime() > Date.now() + 7 * 86_400_000) return null;
  return d;
}

function collectJsonLd($: cheerio.CheerioAPI): JsonLd[] {
  const out: JsonLd[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const obj = node as JsonLd;
    if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(visit);
    if (obj["@type"]) out.push(obj);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw || raw.length > 500_000) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return out;
}

function ldTypes(node: JsonLd): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase());
}

function ldName(value: unknown): string | null {
  if (Array.isArray(value)) {
    const names = value.map(ldName).filter(Boolean) as string[];
    return names.length ? names.join(", ") : null;
  }
  if (typeof value === "string") return /^https?:\/\//.test(value) ? null : text(value);
  if (value && typeof value === "object") return text((value as JsonLd).name);
  return null;
}

function ldImage(value: unknown): string | null {
  if (Array.isArray(value)) return ldImage(value[0]);
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return text((value as JsonLd).url) ?? text((value as JsonLd).contentUrl);
  return null;
}

function ldKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ldKeywords);
  if (typeof value === "string") return value.split(",");
  return [];
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "blockquote", "pre", "code", "kbd", "samp",
    "ul", "ol", "li", "dl", "dt", "dd", "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "sub", "sup", "small",
    "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "abbr", "cite", "q",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["class"],
    pre: ["class"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    abbr: ["title"],
  },
  allowedClasses: { code: [/^language-[\w-]+$/], pre: [/^language-[\w-]+$/] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https", "http"] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow ugc", target: "_blank" },
    }),
    img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy", referrerpolicy: "no-referrer" } }),
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};
// transformTags adds attributes that must also be allowed through.
SANITIZE.allowedAttributes = {
  ...SANITIZE.allowedAttributes,
  a: ["href", "title", "rel", "target"],
  img: ["src", "alt", "title", "width", "height", "loading", "referrerpolicy"],
};

export function sanitizeContentHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE);
}

export function countWords(value: string): number {
  const matches = value.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return matches ? matches.length : 0;
}

export function extractDocument(html: string, pageUrl: string): ExtractedDocument {
  const $ = cheerio.load(html);
  const meta = (...keys: string[]): string | null => {
    for (const key of keys) {
      const el = $(`meta[property="${key}"], meta[name="${key}"], meta[itemprop="${key}"]`).first();
      const v = text(el.attr("content"));
      if (v) return v;
    }
    return null;
  };
  const metaAll = (...keys: string[]): string[] =>
    keys.flatMap((key) =>
      $(`meta[property="${key}"], meta[name="${key}"]`)
        .map((_, el) => text($(el).attr("content")))
        .get()
        .filter(Boolean),
    ) as string[];

  const jsonLd = collectJsonLd($);
  const article = jsonLd.find((n) => ldTypes(n).some((t) => ARTICLE_TYPES.has(t))) ?? null;
  const website = jsonLd.find((n) => ldTypes(n).includes("website")) ?? null;

  const canonicalUrl = absoluteUrl($('link[rel="canonical"]').attr("href"), pageUrl) ?? null;
  const language = text($("html").attr("lang"))?.slice(0, 16) ?? meta("og:locale")?.slice(0, 16) ?? null;

  // ── Main content via Readability on a script-less jsdom document ──
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole });
  let readable: ReturnType<Readability["parse"]> = null;
  try {
    readable = new Readability(dom.window.document, { charThreshold: 300, keepClasses: false }).parse();
  } catch {
    readable = null;
  } finally {
    dom.window.close();
  }

  const rawContentHtml = readable?.content ?? "";
  // Resolve relative links/images inside content before sanitising.
  const $c = cheerio.load(rawContentHtml);
  $c("a[href]").each((_, el) => {
    const abs = absoluteUrl($c(el).attr("href"), pageUrl);
    if (abs) $c(el).attr("href", abs);
    else $c(el).removeAttr("href");
  });
  $c("img").each((_, el) => {
    const src = $c(el).attr("src") ?? $c(el).attr("data-src");
    const abs = absoluteUrl(src, pageUrl);
    if (abs) $c(el).attr("src", abs);
    else $c(el).remove();
  });
  const contentHtml = sanitizeContentHtml($c("body").html() ?? "");
  const contentText = (readable?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const wordCount = countWords(contentText);
  const linkText = $c("a").map((_, el) => $c(el).text()).get().join(" ");
  const linkDensity = wordCount ? Math.min(1, countWords(linkText) / wordCount) : 0;

  // ── Images ──
  const images = new Set<string>();
  const addImage = (v: string | null | undefined) => {
    const abs = absoluteUrl(v, pageUrl);
    if (abs && !abs.startsWith("data:")) images.add(abs);
  };
  addImage(meta("og:image", "og:image:url", "og:image:secure_url"));
  addImage(meta("twitter:image", "twitter:image:src"));
  addImage(ldImage(article?.image));
  $c("img").each((_, el) => {
    if (images.size < 12) addImage($c(el).attr("src"));
  });
  const imageList = [...images].slice(0, 12);

  // ── Tags ──
  const tagSet = new Map<string, string>();
  const addTag = (v: string | null | undefined) => {
    const t = v?.replace(/^#/, "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (t && t.length >= 2 && !tagSet.has(t.toLowerCase())) tagSet.set(t.toLowerCase(), t);
  };
  metaAll("article:tag").forEach(addTag);
  ldKeywords(article?.keywords).forEach(addTag);
  (meta("keywords")?.split(",") ?? []).forEach(addTag);
  $('a[rel~="tag"]').each((_, el) => addTag($(el).text()));

  // ── Scalar fields with source precedence ──
  const title =
    text(article?.headline) ??
    meta("og:title", "twitter:title") ??
    text(readable?.title) ??
    text($("title").first().text()) ??
    text($("h1").first().text());

  const description =
    meta("og:description", "description", "twitter:description") ?? text(article?.description) ?? text(readable?.excerpt);

  const metaAuthor = meta("author", "article:author", "parsely-author", "sailthru.author");
  const author =
    ldName(article?.author) ??
    (metaAuthor && !/^https?:\/\//.test(metaAuthor) ? metaAuthor : null) ??
    text(readable?.byline) ??
    meta("twitter:creator");

  const publishDate =
    parseDate(article?.datePublished) ??
    parseDate(meta("article:published_time", "og:published_time", "datePublished", "date", "pubdate", "publish-date", "dc.date", "DC.date.issued")) ??
    parseDate($("time[datetime]").first().attr("datetime")) ??
    parseDate(readable?.publishedTime) ??
    parseDate(article?.dateCreated);

  const siteName = meta("og:site_name", "application-name") ?? ldName(article?.publisher) ?? text(website?.name) ?? text(readable?.siteName);

  const metadata: Record<string, unknown> = {
    ogType: meta("og:type"),
    ogTitle: meta("og:title"),
    ogDescription: meta("og:description"),
    ogImage: meta("og:image"),
    twitterCard: meta("twitter:card"),
    twitterCreator: meta("twitter:creator"),
    modifiedTime: parseDate(article?.dateModified ?? meta("article:modified_time", "og:updated_time"))?.toISOString() ?? null,
    section: meta("article:section") ?? text(article?.articleSection),
    jsonLdTypes: [...new Set(jsonLd.flatMap(ldTypes))],
    generator: meta("generator"),
    robots: meta("robots"),
    readerable: Boolean(readable),
  };
  for (const k of Object.keys(metadata)) if (metadata[k] == null) delete metadata[k];

  return {
    title: title?.slice(0, 300) ?? null,
    description: description?.slice(0, 2000) ?? null,
    author: author?.slice(0, 200) ?? null,
    publishDate,
    siteName: siteName?.slice(0, 200) ?? null,
    language,
    canonicalUrl,
    thumbnail: imageList[0] ?? null,
    images: imageList,
    tags: [...tagSet.values()].slice(0, 15),
    contentHtml,
    contentText,
    wordCount,
    readingMinutes: Math.max(1, Math.round(wordCount / 230)),
    linkDensity,
    metadata,
  };
}

/** Decide whether a page is a real article/tutorial rather than an index, login wall or stub. */
export function checkMeaningful(doc: ExtractedDocument, minWords: number): MeaningfulCheck {
  if (!doc.title) return { ok: false, reason: "The page has no title." };
  if (!doc.contentText) return { ok: false, reason: "No readable article content was found on the page." };
  if (doc.wordCount < minWords) {
    return { ok: false, reason: `The page contains only ${doc.wordCount} words of readable content (minimum ${minWords}).` };
  }
  if (doc.linkDensity > 0.5) {
    return { ok: false, reason: "The page looks like a list of links (index or landing page), not an article." };
  }
  return { ok: true };
}
