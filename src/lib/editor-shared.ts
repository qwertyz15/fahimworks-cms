/**
 * Rules shared by the Notebook editor (browser) and the server sanitiser, so
 * both sides agree on what's allowed. Pure — no DOM, no Node APIs.
 */

export const TEXT_COLORS = ["gray", "red", "orange", "green", "blue", "purple"] as const;
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple", "orange"] as const;
export type TextColor = (typeof TEXT_COLORS)[number];
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export type VideoProvider = "youtube" | "vimeo";

/** Recognise a YouTube / Vimeo link (watch, share, shorts, embed, player). Null for anything else. */
export function parseVideoUrl(input: string): { provider: VideoProvider; id: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, "");
  const yt = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return yt.test(id) ? { provider: "youtube", id } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? "";
    return yt.test(id) ? { provider: "youtube", id } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/(?:^|\/)(\d{6,12})(?:$|\/)/)?.[1] ?? "";
    return id ? { provider: "vimeo", id } : null;
  }
  return null;
}

/** Privacy-friendly player URLs (no-cookie YouTube, Vimeo do-not-track). */
export function embedSrc(provider: VideoProvider, id: string): string {
  return provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : `https://player.vimeo.com/video/${id}?dnt=1`;
}

/** The only iframe sources the sanitiser keeps. */
export const EMBED_SRC_RE = /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}|player\.vimeo\.com\/video\/\d{6,12})(?:\?[A-Za-z0-9=&_-]*)?$/;
export const EMBED_HOSTS = ["www.youtube-nocookie.com", "player.vimeo.com"];
