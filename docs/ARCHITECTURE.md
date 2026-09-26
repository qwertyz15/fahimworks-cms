# Architecture

Private, single-owner CMS that feeds a separate portfolio website. The owner
submits URLs of content they wrote elsewhere, proves ownership of each URL,
lets the system extract the content, reviews a preview, and publishes it.
The portfolio consumes published items through a read-only public API / RSS.

## 1. High-level design

```
                ┌──────────────────────── Next.js 16 (App Router, Node runtime) ────────────────────────┐
 Browser  ───▶  │ proxy.ts  (auth gate, CSP nonce, security headers)                                    │
 (admin)        │   │                                                                                    │
                │   ├── /login, /register ........ public pages (register only while allowed)           │
                │   ├── /dashboard/** ............ Server Components  ──▶ src/server/queries/*          │
                │   │        └── forms ──────────▶ Server Actions      ──▶ src/server/actions/*          │
                │   │                                   │  requireAdmin() + zod + rate limit             │
                │   │                                   ▼                                                │
                │   │                         src/server/services/*   (domain logic, no HTTP concerns)   │
                │   │                           ├── workflow.ts      state machine (only status writer)  │
                │   │                           ├── verification.ts  meta-tag / file checks              │
                │   │                           ├── extraction.ts    metadata + Readability              │
                │   │                           └── duplicates.ts    URL / title / SimHash similarity    │
                │   │                                   │                                                │
                │   │                         src/lib/http/safe-fetch.ts (SSRF-safe fetch)  ───▶ Internet│
                │   │                                   ▼                                                │
                │   │                              Prisma 7 (driver adapter: pg) ──▶ PostgreSQL          │
                │   │                                                                                    │
 Portfolio ───▶ │   └── /api/public/content, /feed.xml ... read-only, PUBLISHED items only, CORS allowlist│
                └────────────────────────────────────────────────────────────────────────────────────────┘
```

**Layering rules**

| Layer | Location | May import | Responsibility |
|---|---|---|---|
| UI (RSC + client components) | `src/app`, `src/components` | queries, actions, lib | Rendering only |
| Server actions | `src/server/actions` | services, auth, lib | AuthZ, validation, rate limit, revalidation |
| Queries | `src/server/queries` | db | Read models for pages (no side effects) |
| Services | `src/server/services` | db, lib | Business rules; framework-agnostic, unit-testable |
| Lib | `src/lib` | – | Pure utilities (URL normalisation, SimHash, safe fetch, validation) |

Admin functionality is **only** exposed as Server Actions, which Next.js
protects with an Origin/Host check (CSRF) and which additionally call
`requireAdmin()` on every invocation. There are no admin REST routes to
expose. The only route handlers are Auth.js, the read-only public API, RSS,
and a health check.

## 2. Content workflow (state machine)

```
 DRAFT ──issue token──▶ VERIFICATION_PENDING ──check ok──▶ VERIFIED ──extract ok──▶ AWAITING_APPROVAL ──approve──▶ PUBLISHED
   ▲                        │  check failed (stays,                 │ extract failed (stays,     │ reject            │ unpublish
   │                        │  error recorded)                      │ retry available)           ▼                   ▼
   └──────────── reset ─────┴───────────────────────────────────────┴──────────────────── REJECTED        AWAITING_APPROVAL
```

`status` is the single source of truth. `verificationStatus` and
`approvalStatus` are denormalised columns kept in sync by
`services/workflow.ts` — the *only* code allowed to change any of the three —
so the content table can filter on them cheaply. Illegal transitions throw.

Editing the URL of a verified item resets it to `DRAFT` (ownership must be
re-proven for the new URL).

## 3. Ownership verification

A token is 32 bytes from `crypto.randomBytes`, base64url encoded, bound to
one content item, one method and an expiry (default 72 h, configurable).

| Method | Owner action | System check |
|---|---|---|
| `META_TAG` | Add `<meta name="portfolio-verification" content="TOKEN">` to the page | Fetch the **submitted URL**, parse `<head>` with cheerio, constant-time compare every `portfolio-verification` meta value |
| `FILE` | Serve `portfolio-verification-TOKEN.txt` at the site root containing `TOKEN` | Fetch `https://<host>/portfolio-verification-TOKEN.txt` (no cross-host redirects), body trimmed must equal token, `text/*` content type, ≤ 4 KB |

Checks record `attempts`, `lastCheckedAt`, `lastError`. Redirects are
followed (max 5), but the final URL must stay on the same registrable host as
the submitted URL, otherwise verification fails — this prevents "verify a
page that redirects to a page I own".

### SSRF protection (`lib/http/safe-fetch.ts`)
Every outbound request: http/https only, no credentials in URL, standard
ports only, DNS resolved and every address checked against private/loopback/
link-local/CGNAT/multicast ranges (IPv4 + IPv6, incl. mapped addresses),
manual redirect handling with re-validation per hop, 10 s timeout, 5 MB body
cap, streaming read with abort. Blocking of private ranges can be disabled
only via `ALLOW_PRIVATE_NETWORK_FETCH=true` for local development.

## 4. Extraction pipeline

1. `safeFetch` the verified URL (HTML content types only).
2. **Metadata** (cheerio): `<title>`, OpenGraph, Twitter cards, `article:*`,
   `<meta name=author|description|keywords>`, `<link rel=canonical>`,
   `<html lang>`, and JSON-LD (`Article`, `BlogPosting`, `TechArticle`,
   `ScholarlyArticle`, `HowTo`, incl. `@graph`).
3. **Main content**: Mozilla Readability on a linkedom document
   (never executes scripts, loads no resources; loaded lazily).
4. **Sanitise**: `sanitize-html` allowlist → stored `contentHtml`; plain text
   → `contentText`, `wordCount`, `readingMinutes`.
5. **Summary**: first meaningful sentences up to ~320 chars (pluggable:
   `SummaryProvider` interface, ready for an AI provider later).
6. **Meaningfulness gate**: reject when word count < `minWordCount`
   (setting, default 150) or text/link density indicates an index/landing
   page.
7. **Fingerprints**: SHA-256 of normalised text, 64-bit SimHash.

## 5. Duplicate detection

| Check | Technique | Result |
|---|---|---|
| URL | `normalizeUrl()` (lower-case host, strip `www.`, default ports, fragments, tracking params, trailing slash, sort query) → unique index `normalizedUrl` | **Blocks** creation |
| Title | Normalised exact match + Sørensen–Dice bigram similarity ≥ 0.85 | Warning |
| Content | Exact SHA-256 match or SimHash Hamming distance ≤ 6 | Warning |

Warnings are stored on the item (`duplicateWarnings` JSON) and displayed on
the add screen, preview, and approval step. The admin can proceed anyway.
For large corpora the in-app comparison can be swapped for `pg_trgm` /
`pgvector` without changing callers.

## 6. Security model

| Concern | Control |
|---|---|
| Registration | Allowed only while `SystemSettings.allowRegistration` is true. First signup runs in a transaction holding a row lock on the settings singleton; it becomes `ADMIN` and flips the flag off atomically (race-safe). |
| Passwords | bcrypt (cost 12), zod policy (≥ 12 chars, mixed classes), constant-time dummy compare for unknown emails |
| Sessions | Auth.js JWT in `__Secure-` HttpOnly, SameSite=Lax cookie; `sessionVersion` embedded and re-checked against DB in `requireAdmin()` so password change / "sign out everywhere" revokes all sessions |
| AuthZ | `proxy.ts` gate for `/dashboard/**` **and** `requireAdmin()` inside every action/query (defence in depth) |
| CSRF | Server Actions: built-in Origin vs Host check (+ `ALLOWED_ORIGINS`). Auth.js endpoints: double-submit CSRF token. |
| Input | zod schemas at every boundary |
| SQL injection | Prisma parameterised queries only; the single raw query uses tagged templates |
| XSS | React escaping; extracted HTML sanitised with an allowlist on write (scripts, handlers, `javascript:` URLs stripped) and shown only in the admin preview; nonce-based CSP as a second layer; `img` with `referrerPolicy=no-referrer` |
| Rate limiting | Token bucket per IP+action (login, register, verification checks, public API). In-memory by default; `RateLimitStore` interface for Redis in multi-instance deployments |
| Headers | CSP, HSTS (prod), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy |
| Auditing | `AuditLog` row for every privileged action |

## 7. Data model (summary — see `prisma/schema.prisma`)

- **User** — `role` (`ADMIN` \| `EDITOR`), `sessionVersion`, `lastLoginAt`.
- **Content** — URL, normalised URL, type, workflow statuses, metadata,
  extracted content, fingerprints, `slug` for the portfolio, `authorId`
  (owning user — enables multi-author later), tags (m:n).
- **Tag** — normalised unique `slug`.
- **VerificationToken** — per content item & method, expiry, attempt log.
- **SystemSettings** — singleton (`id = 1`): `allowRegistration`, site
  settings, `minWordCount`, `tokenTtlHours`, `publicApiEnabled`,
  `allowedOrigins`.
- **AuditLog** — actor, action, target, metadata, IP.

## 8. Extensibility

| Future feature | Hook already in place |
|---|---|
| Multiple authors | `Content.authorId`, `Role.EDITOR`, `requireRole()` helper, audit actor |
| Newsletters | `PUBLISHED` event emitted from `workflow.ts` (`onPublished` hook list) |
| Analytics | Public API returns stable `id`/`slug`; add `ContentView` model keyed on it |
| Comments | `Content.id` stable; public API is the natural attachment point |
| AI summaries | `SummaryProvider` interface in `services/summary.ts` |
| RSS | `/feed.xml` implemented |
| Horizontal scaling | Stateless JWT sessions, `RateLimitStore` interface, no local file storage |

## 9. Folder structure

```
.
├── docker/                       entrypoint script
├── docs/                         ARCHITECTURE.md, DEPLOYMENT.md
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── prisma.config.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login, (auth)/register
│   │   ├── dashboard/            layout (sidebar), overview
│   │   │   ├── content/          table, [id] detail+preview, [id]/edit
│   │   │   ├── add/
│   │   │   └── settings/
│   │   ├── api/auth/[...nextauth]
│   │   ├── api/public/content    read-only published content (+ [slug])
│   │   ├── api/health
│   │   └── feed.xml              RSS 2.0
│   ├── auth.ts, auth.config.ts   Auth.js configuration
│   ├── proxy.ts                  auth gate + CSP nonce + headers
│   ├── components/{ui,dashboard,content,auth}
│   ├── generated/prisma          Prisma client (generated, git-ignored)
│   ├── lib/                      env, db, utils, url, similarity, rate-limit, http/safe-fetch, validation
│   └── server/
│       ├── auth/                 requireAdmin, password, session helpers
│       ├── actions/              "use server" entry points
│       ├── queries/              read models
│       └── services/             workflow, verification, extraction, duplicates, summary, audit, settings
├── tests/                        vitest unit tests for lib + services
├── Dockerfile, docker-compose.yml, .env.example
```
