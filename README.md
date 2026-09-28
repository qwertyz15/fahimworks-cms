# Portfolio CMS

A private, single-owner dashboard for managing the blogs, tutorials, research articles and projects shown on your portfolio.
You paste a URL, the system analyzes it (preview, duplicate check, content check), and you publish it in one click. Your portfolio reads published items from a read-only JSON API or RSS feed.

**Stack:** Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · PostgreSQL · Prisma 7 · Auth.js v5 · Docker

- Architecture, data model, security model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Deployment and production checklist: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Workflow

`Draft → Waiting for approval → Published` (plus Rejected/Reopen and Unpublish)

1. **Analyze** (`/dashboard/add`): exact duplicates (after URL normalization) are blocked, similar titles and
   content trigger a warning, and pages without meaningful content are rejected. You see a preview.
2. **Publish** (or **Save for review**): the page is extracted — title, description, author, date, images, tags,
   main content (Readability, sanitized), a summary and content fingerprints — and published immediately.
   *Save for review* stops at *Waiting for approval* so you can edit before publishing.

Only the signed-in admin can add content, so there is no per-URL ownership check.

## Local development

Prerequisites: Node.js ≥ 20.19, and PostgreSQL (or Docker).

```bash
npm install                                   # also generates the Prisma client
cp .env.example .env                          # set DATABASE_URL and AUTH_SECRET (openssl rand -base64 48)

# PostgreSQL via Docker, if you don't have one:
docker run -d --name portfolio-pg -e POSTGRES_USER=portfolio -e POSTGRES_PASSWORD=portfolio \
  -e POSTGRES_DB=portfolio -p 5432:5432 postgres:17-alpine

npx prisma migrate dev                        # apply migrations
npm run dev                                   # http://localhost:3000 → /register creates the admin
```

To import pages from a site on your own machine, set `ALLOW_PRIVATE_NETWORK_FETCH="true"` (development only).

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (Vitest): URL normalization, SSRF guard, extraction, duplicates |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npx prisma migrate dev --name <change>` | Create a new migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:studio` | Browse the database |

## Public API (for your portfolio)

Read-only, returns **published items only**, rate-limited, and can be turned off in Settings.

```
GET /api/public/content?type=BLOG|TUTORIAL|ARTICLE|PROJECT&tag=<slug>&featured=true&limit=20&cursor=<id>
GET /api/public/content/<slug>
GET /feed.xml
```

```json
{ "items": [{ "id": "…", "slug": "building-a-cms", "title": "…", "url": "https://…", "type": "TUTORIAL",
  "description": "…", "summary": "…", "thumbnail": "…", "author": "…", "publishDate": "…",
  "readingMinutes": 6, "featured": false, "tags": [{ "name": "Next.js", "slug": "next-js" }] }],
  "nextCursor": null }
```

## Project structure

```
prisma/                 schema.prisma, migrations/
src/app/                routes: (auth)/login|register, dashboard/**, api/public/**, api/health, feed.xml
src/proxy.ts            auth gate + per-request CSP nonce
src/auth.ts             Auth.js (credentials, JWT, session revocation)
src/server/actions/     Server Actions: every one re-checks admin auth and is rate-limited
src/server/services/    workflow state machine, extraction, duplicates, summary
src/server/queries/     read models for pages and the public API
src/lib/                env, db, URL normalization, similarity, rate limiting, SSRF-safe fetch
src/components/         UI primitives, dashboard and content components
tests/                  unit tests
```
