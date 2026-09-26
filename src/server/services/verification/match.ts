import * as cheerio from "cheerio";
import { timingSafeEqual } from "node:crypto";

/** Pure verification helpers (no I/O) — unit tested in tests/verification.test.ts. */

export const META_NAME = "portfolio-verification";
export const FILE_PREFIX = "portfolio-verification-";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function metaTagSnippet(token: string) {
  return `<meta name="${META_NAME}" content="${token}">`;
}

export function verificationFileName(token: string) {
  return `${FILE_PREFIX}${token}.txt`;
}

/** The file must live at the root of the submitted URL's origin. */
export function verificationFileUrl(pageUrl: string, token: string): string {
  return new URL(`/${verificationFileName(token)}`, new URL(pageUrl).origin).href;
}

export type MetaMatch = { found: false } | { found: true; matches: boolean; count: number };

/**
 * Look for `<meta name="portfolio-verification">` inside <head> only.
 * Tags in <body> are ignored so that user-generated content (comments, embeds)
 * on a page cannot be used to claim someone else's page.
 */
export function findMetaToken(html: string, token: string): MetaMatch {
  const $ = cheerio.load(html);
  const values = $("head meta")
    .filter((_, el) => ($(el).attr("name") ?? "").trim().toLowerCase() === META_NAME)
    .map((_, el) => ($(el).attr("content") ?? "").trim())
    .get();
  if (!values.length) return { found: false };
  return { found: true, matches: values.some((v) => safeEqual(v, token)), count: values.length };
}

export function fileBodyMatches(body: string, token: string): boolean {
  // Allow a trailing newline / BOM, nothing else.
  const cleaned = body.replace(/^﻿/, "").trim();
  return safeEqual(cleaned, token);
}
