"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { fieldErrors, loginSchema, registerSchema } from "@/lib/validation";
import { hashPassword } from "@/server/auth/password";
import { audit } from "@/server/services/audit";
import { toActionError, formString, type ActionResult } from "./result";

function safeCallback(value: string): string {
  // Only same-app relative paths — prevents open redirects.
  return value.startsWith("/dashboard") && !value.startsWith("//") ? value : "/dashboard";
}

export async function loginAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ email: formString(form, "email"), password: formString(form, "password") });
  if (!parsed.success) return { ok: false, error: "Enter your email and password.", fieldErrors: fieldErrors(parsed.error) };

  try {
    await signIn("credentials", { ...parsed.data, redirectTo: safeCallback(formString(form, "callbackUrl")) });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthError) {
      const code = (err as AuthError & { code?: string }).code;
      if (code === "rate_limited") return { ok: false, error: "Too many sign-in attempts. Please wait 15 minutes and try again." };
      return { ok: false, error: "Invalid email or password." };
    }
    return toActionError(err);
  }
}

class RegistrationClosedError extends Error {}

export async function registerAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    const parsed = registerSchema.safeParse({
      name: formString(form, "name"),
      email: formString(form, "email"),
      password: formString(form, "password"),
      confirmPassword: formString(form, "confirmPassword"),
    });
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const { name, email, password } = parsed.data;

    // Counted only for well-formed submissions: typos in the form don't lock out
    // a first-time admin, while the expensive hashing path stays protected.
    const ip = await clientIp();
    await enforceRateLimit(`register:${ip}`, RATE_LIMITS.register);

    // Hash before taking the lock — bcrypt is intentionally slow.
    const passwordHash = await hashPassword(password);

    const user = await db.$transaction(async (tx) => {
      // Row lock on the settings singleton serialises concurrent registrations,
      // so exactly one request can become the first ADMIN.
      const rows = await tx.$queryRaw<{ allow_registration: boolean }[]>`
        SELECT allow_registration FROM system_settings WHERE id = 1 FOR UPDATE`;
      if (!rows[0]?.allow_registration) throw new RegistrationClosedError();

      const isFirst = (await tx.user.count()) === 0;
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new RegistrationClosedError();
      }
      const created = await tx.user.create({ data: { name, email, passwordHash, role: isFirst ? "ADMIN" : "EDITOR" } });
      if (isFirst) await tx.systemSettings.update({ where: { id: 1 }, data: { allowRegistration: false } });
      return created;
    });

    await audit({ actorId: user.id, action: "auth.register", targetType: "user", targetId: user.id, metadata: { role: user.role }, ip });
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return { ok: true };
  } catch (err) {
    if (err instanceof RegistrationClosedError) {
      // Same message for "closed" and "email taken" — avoids account enumeration.
      return { ok: false, error: "Registration is not available. Please sign in instead." };
    }
    return toActionError(err);
  }
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/login");
}
