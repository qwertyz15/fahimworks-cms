/**
 * URL helpers shared by validation, fetching and duplicate detection.
 * Pure functions — safe to unit test and to import from client code.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "gclid",
  "fbclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "igshid",
  "_hsenc",
  "_hsmi",
  "yclid",
]);

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Structural validation of a user-submitted URL (network checks happen in safe-fetch). */
export function parseSubmittedUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "URL is required." };
  if (raw.length > 2048) return { ok: false, error: "URL is too long (max 2048 characters)." };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Enter a valid absolute URL, including https://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http:// and https:// URLs are supported." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URLs containing credentials are not allowed." };
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    return { ok: false, error: "URL must use a fully-qualified domain name." };
  }
  if (url.port && url.port !== "80" && url.port !== "443" && process.env.ALLOW_PRIVATE_NETWORK_FETCH !== "true") {
    return { ok: false, error: "Only standard ports (80/443) are supported." };
  }
  url.hash = "";
  return { ok: true, url };
}

/**
 * Canonical representation of a URL for duplicate detection:
 * lower-case host without "www.", no default port, no fragment, no tracking
 * params, sorted query, no trailing slash, scheme-insensitive.
 */
export function normalizeUrl(input: string | URL): string {
  const url = new URL(typeof input === "string" ? input.trim() : input.href);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const port = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";

  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";

  let path = url.pathname.replace(/\/{2,}/g, "/");
  path = path.replace(/\/(index|default)\.(html?|php|aspx?)$/i, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/") path = "";

  let decodedPath = path;
  try {
    decodedPath = decodeURI(path);
  } catch {
    /* keep encoded form */
  }

  return `${host}${port}${decodedPath}${query}`;
}

/** Host comparison that ignores a leading "www." */
export function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

/** Resolve a possibly-relative URL against a base; returns undefined when invalid or non-http(s). */
export function absoluteUrl(value: string | undefined | null, base: string | URL): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
