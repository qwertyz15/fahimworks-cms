import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { sendAlert } from "./alerts";

/**
 * Errors seen by the app, grouped: one row per distinct error (fingerprint)
 * with a count. A new error, or one coming back after being resolved, sends a
 * push alert; repeats alert at most once an hour. Recording never throws.
 */

export type ErrorSource = "server" | "client" | "health";
const ALERT_EVERY_MS = 60 * 60 * 1000;

/** Same error, different ids / numbers / URLs → same group. */
export function normalizeMessage(message: string) {
  return message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[a-z0-9]{20,}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300);
}

/** The first stack line that points at our code. */
function topFrame(stack?: string | null) {
  return (stack ?? "").split("\n").find((l) => /at\s/.test(l) && !/node_modules|node:internal/.test(l))?.trim().replace(/:\d+:\d+\)?$/, "") ?? "";
}

export function fingerprintOf(source: ErrorSource, message: string, stack?: string | null, route?: string | null) {
  return createHash("sha256").update([source, normalizeMessage(message), topFrame(stack), route ?? ""].join("|")).digest("hex").slice(0, 32);
}

export async function recordError(input: { source: ErrorSource; message: string; stack?: string | null; route?: string | null; digest?: string | null }) {
  try {
    const message = (input.message || "Unknown error").slice(0, 2000);
    const stack = input.stack?.slice(0, 8000) ?? null;
    const route = input.route?.slice(0, 300) ?? null;
    const fingerprint = fingerprintOf(input.source, message, stack, route);
    const now = new Date();
    const prev = await db.errorEvent.findUnique({ where: { fingerprint }, select: { id: true, lastAlertedAt: true, resolvedAt: true, count: true } });
    const isNew = !prev;
    const regressed = !!prev?.resolvedAt;
    const due = isNew || regressed || !prev?.lastAlertedAt || now.getTime() - prev.lastAlertedAt.getTime() > ALERT_EVERY_MS;
    const row = await db.errorEvent.upsert({
      where: { fingerprint },
      create: { fingerprint, source: input.source, message, stack, route, digest: input.digest ?? null },
      update: { count: { increment: 1 }, lastSeen: now, message, stack, route, digest: input.digest ?? undefined, ...(regressed ? { resolvedAt: null } : {}) },
      select: { id: true, count: true },
    });
    if (!due) return;
    const base = (process.env.AUTH_URL ?? "").replace(/\/+$/, "");
    const sent = await sendAlert({
      title: `${isNew ? "New error" : regressed ? "Error is back" : "Error still happening"} (${input.source})`,
      message: `${message}${route ? `\n${route}` : ""}${row.count > 1 ? `\nSeen ${row.count} times` : ""}`,
      priority: input.source === "health" ? "urgent" : "high",
      tags: ["warning"],
      click: base ? `${base}/dashboard/settings#system` : undefined,
    });
    if (sent) await db.errorEvent.update({ where: { id: row.id }, data: { lastAlertedAt: now } });
  } catch (err) {
    // Never let error reporting cause more errors.
    console.error("[errors] could not record an error", err);
  }
}

export async function listErrors(opts: { includeResolved?: boolean } = {}) {
  return db.errorEvent.findMany({ where: opts.includeResolved ? {} : { resolvedAt: null }, orderBy: { lastSeen: "desc" }, take: 100 });
}

export async function resolveError(id: string) {
  await db.errorEvent.update({ where: { id }, data: { resolvedAt: new Date() } });
}

export async function resolveAllErrors() {
  await db.errorEvent.updateMany({ where: { resolvedAt: null }, data: { resolvedAt: new Date() } });
}
