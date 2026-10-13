"use server";

import { z } from "zod";
import { alertsConfigured, sendAlert } from "@/server/services/alerts";
import { resolveAllErrors, resolveError } from "@/server/services/errors";
import { adminAction, type ActionResult } from "./result";

export async function testAlertAction(): Promise<ActionResult> {
  return adminAction(async () => {
    if (!alertsConfigured()) return { ok: false, error: "Alerts aren't set up: add ALERT_NTFY_TOPIC in Vercel (see Settings → System)." };
    const ok = await sendAlert({ title: "Test alert from your CMS", message: "Alerts work. You'll get one like this when something breaks.", tags: ["white_check_mark"] });
    return ok ? { ok: true, message: "Test alert sent — check your phone." } : { ok: false, error: "ntfy didn't accept the alert. Check the topic (and token, if you use one)." };
  });
}

export async function resolveErrorAction(payload: unknown): Promise<ActionResult> {
  return adminAction(async () => {
    const input = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(), all: z.boolean().optional() }).parse(payload);
    if (input.all) await resolveAllErrors();
    else if (input.id) await resolveError(input.id);
    return { ok: true };
  });
}
