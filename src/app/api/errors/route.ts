import { z } from "zod";
import { AuthorizationError, requireAdmin } from "@/server/auth/guards";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit";
import { recordError } from "@/server/services/errors";

/** Browser errors from the dashboard (signed-in admin only, rate limited, size limited). */
const schema = z.object({ message: z.string().max(2000), stack: z.string().max(8000).optional(), url: z.string().max(500).optional() });

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAdmin("throw");
  } catch (err) {
    if (err instanceof AuthorizationError) return new Response(null, { status: 401 });
    throw err;
  }
  try {
    await enforceRateLimit(`client-error:${user.id}`, { limit: 30, windowMs: 60_000 });
  } catch (err) {
    if (err instanceof RateLimitError) return new Response(null, { status: 429 });
    throw err;
  }
  const raw = await req.text();
  if (raw.length > 12_000) return new Response(null, { status: 413 });
  const parsed = schema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return new Response(null, { status: 400 });
  let route: string | null = null;
  try {
    route = parsed.data.url ? new URL(parsed.data.url).pathname : null;
  } catch {
    route = null;
  }
  await recordError({ source: "client", message: parsed.data.message, stack: parsed.data.stack, route });
  return new Response(null, { status: 204 });
}
