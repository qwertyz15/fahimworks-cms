import "server-only";
import dns from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch, type Response } from "undici";
import { env } from "@/lib/env";
import { parseSubmittedUrl } from "@/lib/url";
import { isBlockedAddress } from "./ip";

export type FetchErrorCode =
  | "INVALID_URL"
  | "BLOCKED_ADDRESS"
  | "DNS_FAILURE"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "HTTP_ERROR"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "TOO_MANY_REDIRECTS"
  | "CROSS_SITE_REDIRECT"
  | "NETWORK_ERROR";

export class SafeFetchError extends Error {
  constructor(
    public code: FetchErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  /** Accepted content types (prefix match, e.g. "text/html"). Empty = any. */
  accept?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Called for each redirect hop; throw to abort (e.g. cross-site check). */
  onRedirect?: (from: URL, to: URL) => void;
}

export interface SafeFetchResult {
  url: URL;
  finalUrl: URL;
  redirects: string[];
  status: number;
  contentType: string;
  headers: Headers;
  body: string;
}

const allowPrivate = () => env().ALLOW_PRIVATE_NETWORK_FETCH;

/**
 * DNS lookup that refuses private addresses. Running the check inside the
 * socket's lookup (rather than before the request) closes the DNS-rebinding
 * window: the address we validate is the address we connect to.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (!list.length) return callback(new SafeFetchError("DNS_FAILURE", `Could not resolve ${hostname}.`), "", 0);
    if (!allowPrivate()) {
      const bad = list.find((a) => isBlockedAddress(a.address));
      if (bad) {
        return callback(
          new SafeFetchError("BLOCKED_ADDRESS", `${hostname} resolves to a private or reserved address.`),
          "",
          0,
        );
      }
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

const globalAgent = globalThis as unknown as { __safeFetchAgent?: Agent };
const agent =
  globalAgent.__safeFetchAgent ??
  (globalAgent.__safeFetchAgent = new Agent({
    connect: { lookup: guardedLookup, timeout: 10_000 },
    headersTimeout: 15_000,
    bodyTimeout: 15_000,
  }));

function assertSafeTarget(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allowPrivate() && isBlockedAddress(host)) {
    throw new SafeFetchError("BLOCKED_ADDRESS", "The URL points to a private or reserved IP address.");
  }
  if (!allowPrivate() && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))) {
    throw new SafeFetchError("BLOCKED_ADDRESS", "The URL points to a local host name.");
  }
}

async function readLimited(res: Response, maxBytes: number, controller: AbortController): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    controller.abort();
    throw new SafeFetchError("TOO_LARGE", `Response is larger than ${Math.round(maxBytes / 1024)} KB.`);
  }
  if (!res.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    const bytes = chunk as Uint8Array;
    total += bytes.byteLength;
    if (total > maxBytes) {
      controller.abort();
      throw new SafeFetchError("TOO_LARGE", `Response is larger than ${Math.round(maxBytes / 1024)} KB.`);
    }
    chunks.push(bytes);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const headerCharset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  let charset = headerCharset;
  if (!charset) {
    // Sniff <meta charset> in the first 2 KB.
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function describeNetworkError(err: unknown): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof SafeFetchError) return cause;
  const code = (cause as { code?: string })?.code ?? (err as { code?: string })?.code;
  if ((err as Error)?.name === "AbortError" || (err as Error)?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return new SafeFetchError("TIMEOUT", "The site took too long to respond.");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new SafeFetchError("DNS_FAILURE", "The domain could not be resolved.");
  if (code === "ECONNREFUSED") return new SafeFetchError("NETWORK_ERROR", "The connection was refused.");
  if (code?.startsWith("ERR_TLS") || code?.includes("CERT")) return new SafeFetchError("NETWORK_ERROR", "The site's TLS certificate is invalid.");
  return new SafeFetchError("NETWORK_ERROR", "The page could not be reached.");
}

/**
 * Fetch an untrusted URL safely: scheme/port validation, private-address
 * blocking at connect time, manual redirect validation, timeout, and a hard
 * cap on response size.
 */
export async function safeFetch(input: string | URL, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const cfg = env();
  const maxBytes = opts.maxBytes ?? cfg.FETCH_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? cfg.FETCH_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? 5;

  const initial = parseSubmittedUrl(typeof input === "string" ? input : input.href);
  if (!initial.ok) throw new SafeFetchError("INVALID_URL", initial.error);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const redirects: string[] = [];
  let current = initial.url;

  try {
    for (let hop = 0; ; hop++) {
      assertSafeTarget(current);
      let res: Response;
      try {
        res = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          dispatcher: agent,
          headers: {
            "user-agent": cfg.FETCH_USER_AGENT,
            accept: opts.accept?.length ? `${opts.accept.join(", ")};q=1, */*;q=0.1` : "*/*",
            "accept-language": "en;q=1, *;q=0.5",
          },
        });
      } catch (err) {
        throw describeNetworkError(err);
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        if (hop >= maxRedirects) throw new SafeFetchError("TOO_MANY_REDIRECTS", `More than ${maxRedirects} redirects.`);
        const next = parseSubmittedUrl(new URL(res.headers.get("location")!, current).href);
        if (!next.ok) throw new SafeFetchError("INVALID_URL", `Redirected to an invalid URL: ${next.error}`);
        opts.onRedirect?.(current, next.url);
        redirects.push(next.url.href);
        current = next.url;
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        const reason = res.status === 404 ? "Page not found (404)." : res.status === 403 || res.status === 401 ? `Access denied (${res.status}).` : `The server responded with HTTP ${res.status}.`;
        throw new SafeFetchError("HTTP_ERROR", reason, res.status);
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (opts.accept?.length && !opts.accept.some((a) => contentType.startsWith(a))) {
        await res.body?.cancel().catch(() => {});
        throw new SafeFetchError("UNSUPPORTED_CONTENT_TYPE", `Unexpected content type "${contentType || "unknown"}".`);
      }

      let bytes: Uint8Array;
      try {
        bytes = await readLimited(res, maxBytes, controller);
      } catch (err) {
        throw describeNetworkError(err);
      }

      const headers = new Headers();
      res.headers.forEach((v, k) => headers.set(k, v));
      return {
        url: initial.url,
        finalUrl: current,
        redirects,
        status: res.status,
        contentType,
        headers,
        body: decode(bytes, contentType),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
