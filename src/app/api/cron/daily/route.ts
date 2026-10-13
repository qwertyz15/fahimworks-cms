import { db } from "@/lib/db";
import { checkStorage } from "@/lib/storage";
import { recordError } from "@/server/services/errors";
import { purgeExpiredTrash } from "@/server/services/trash";

/**
 * Daily job (Vercel Cron): checks the database and storage (alerting if
 * either is down) and deletes trash older than 30 days. Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET it's disabled.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const result: Record<string, unknown> = {};
  try {
    await db.$queryRaw`SELECT 1`;
    result.database = "ok";
  } catch (err) {
    result.database = "down";
    // Can't record in the database when it's the thing that's down: alert directly.
    const { sendAlert } = await import("@/server/services/alerts");
    await sendAlert({ title: "Database is unreachable", message: err instanceof Error ? err.message : String(err), priority: "urgent", tags: ["rotating_light"] });
    return Response.json(result, { status: 503 });
  }
  const storage = await checkStorage();
  result.storage = storage;
  if (storage !== "ok" && storage !== "off") await recordError({ source: "health", message: `Media storage is unreachable: ${storage}`, route: "daily check" });
  try {
    result.trashPurged = await purgeExpiredTrash();
  } catch (err) {
    await recordError({ source: "health", message: `Trash cleanup failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, route: "daily check" });
  }
  return Response.json(result);
}
