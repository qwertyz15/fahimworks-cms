"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { db } from "@/lib/db";
import { changePasswordSchema, settingsSchema } from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { audit } from "@/server/services/audit";
import { adminAction, formString, type ActionResult } from "./result";
import { RATE_LIMITS } from "@/lib/rate-limit";

export async function updateSettingsAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return adminAction(async (user) => {
    const input = settingsSchema.parse({
      siteName: formString(form, "siteName"),
      portfolioUrl: formString(form, "portfolioUrl"),
      minWordCount: formString(form, "minWordCount"),
      tokenTtlHours: formString(form, "tokenTtlHours"),
      allowRegistration: formString(form, "allowRegistration") === "on",
      publicApiEnabled: formString(form, "publicApiEnabled") === "on",
      allowedOrigins: formString(form, "allowedOrigins"),
    });
    const allowedOrigins = input.allowedOrigins.map((o) => new URL(o).origin);
    await db.systemSettings.update({ where: { id: 1 }, data: { ...input, allowedOrigins } });
    await audit({ actorId: user.id, action: "settings.updated", targetType: "settings", metadata: { ...input, allowedOrigins } });
    revalidatePath("/dashboard", "layout");
    return { ok: true, message: "Settings saved." };
  });
}

export async function changePasswordAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const result = await adminAction(
    async (user) => {
      const input = changePasswordSchema.parse({
        currentPassword: formString(form, "currentPassword"),
        newPassword: formString(form, "newPassword"),
        confirmPassword: formString(form, "confirmPassword"),
      });
      const record = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
      if (!(await verifyPassword(input.currentPassword, record.passwordHash))) {
        return { ok: false, error: "Current password is incorrect.", fieldErrors: { currentPassword: "Incorrect password." } };
      }
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(input.newPassword), sessionVersion: { increment: 1 } },
      });
      await audit({ actorId: user.id, action: "auth.password_changed", targetType: "user", targetId: user.id });
      return { ok: true };
    },
    { rateLimit: { key: "password", rule: RATE_LIMITS.login } },
  );
  if (!result.ok) return result;
  // All sessions (including this one) are now invalid.
  await signOut({ redirect: false });
  redirect("/login?reason=password-changed");
}

export async function signOutEverywhereAction(): Promise<ActionResult> {
  const result = await adminAction(async (user) => {
    await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    await audit({ actorId: user.id, action: "auth.sessions_revoked", targetType: "user", targetId: user.id });
    return { ok: true };
  });
  if (!result.ok) return result;
  await signOut({ redirect: false });
  redirect("/login?reason=signed-out-everywhere");
}
