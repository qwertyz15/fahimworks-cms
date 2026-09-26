import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma/enums";

export class AuthorizationError extends Error {
  constructor(message = "You are not allowed to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type SessionUser = { id: string; name: string; email: string; role: Role };

/** Current user loaded from the database, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true },
  });
}

/**
 * Guard for pages and server actions. Every privileged entry point calls this
 * even though proxy.ts already gates /dashboard — defence in depth.
 *  - In pages: redirects to /login when signed out.
 *  - In actions (`mode: "throw"`): throws, so the action returns an error.
 */
export async function requireRole(roles: Role[], mode: "redirect" | "throw" = "redirect"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    if (mode === "redirect") redirect("/login");
    throw new AuthorizationError("Your session has expired. Please sign in again.");
  }
  if (!roles.includes(user.role)) {
    if (mode === "redirect") redirect("/login?error=AccessDenied");
    throw new AuthorizationError();
  }
  return user;
}

export const requireAdmin = (mode: "redirect" | "throw" = "redirect") => requireRole(["ADMIN"], mode);
