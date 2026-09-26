import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Role } from "@/generated/prisma/enums";

export class AuthorizationError extends Error {
  constructor(message = "You are not allowed to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export type SessionUser = { id: string; name: string; email: string; role: Role };

/**
 * Current user, or null. auth() runs the jwt callback, which re-validates the
 * user and session version against the database on every call and refreshes
 * name/email/role — so the session is authoritative. cache() makes the layout,
 * page and queries of one request share a single lookup.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };
});

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
