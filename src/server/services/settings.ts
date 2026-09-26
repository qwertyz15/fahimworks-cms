import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { SystemSettings } from "@/generated/prisma/client";

/** The settings singleton. The row is created by the initial migration; upsert is a safety net. */
export const getSettings = cache(async (): Promise<SystemSettings> => {
  return db.systemSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
});

export async function registrationState() {
  const [settings, userCount] = await Promise.all([getSettings(), db.user.count()]);
  return {
    allowed: settings.allowRegistration,
    isFirstUser: userCount === 0,
  };
}
