# Deployment

## Option A — Docker Compose (recommended)

```bash
cp .env.example .env
# Required: AUTH_SECRET (openssl rand -base64 48), POSTGRES_PASSWORD, AUTH_URL
# For HTTPS: DOMAIN=cms.example.com and AUTH_URL=https://cms.example.com

docker compose up -d --build                  # app on :3000 (put your own TLS proxy in front)
docker compose --profile https up -d --build  # + Caddy with automatic Let's Encrypt HTTPS
```

Startup order: `db` (healthy) → `migrate` runs `prisma migrate deploy` and exits → `app`.
Re-running `up --build` after a pull applies new migrations automatically.

Then open `/register` once to create the admin account. Registration closes automatically after that.

**Backups:** `docker compose exec db pg_dump -U portfolio portfolio > backup.sql`

## Option B — Node.js host / PaaS

```bash
npm ci
npx prisma migrate deploy
npm run build
cp -r .next/static .next/standalone/.next/
node .next/standalone/server.js     # PORT / HOSTNAME env vars respected
```

On Vercel/Render/Fly: set the env vars from `.env.example`, use `npx prisma migrate deploy && npm run build`
as the build command, and use any managed PostgreSQL.

## Production checklist

- [ ] Serve over **HTTPS only**. `AUTH_URL` must start with `https://`, which enables `__Secure-` cookies,
      HSTS and `upgrade-insecure-requests`.
- [ ] `AUTH_SECRET` is at least 32 random bytes and never committed.
- [ ] `ALLOW_PRIVATE_NETWORK_FETCH=false`. It exists only for local testing and allows SSRF when enabled.
- [ ] Run behind **one** reverse proxy that sets `X-Forwarded-For`, and keep `TRUSTED_PROXY_HOPS=1`.
      Without a proxy, all clients share one rate-limit bucket (`unknown`), so failed logins by anyone
      delay everyone for up to 15 minutes.
- [ ] The rate limiter is in memory. If you run more than one app instance, implement `RateLimitStore`
      (e.g. Redis) and register it with `setRateLimitStore()`.
- [ ] If the proxy rewrites `Host`, add the public hostname to `ALLOWED_ORIGINS` (Server Action CSRF check).
- [ ] Add your portfolio's origin under **Settings → Allowed origins** if it calls the API from the browser.
- [ ] Optional: set `SCREENSHOT_URL_TEMPLATE` for live screenshots in the preview.
