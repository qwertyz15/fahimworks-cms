import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/validation";
import { RATE_LIMITS, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request";
import { verifyPassword } from "@/server/auth/password";
import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role?: Role;
    sessionVersion?: number;
  }
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    sv?: number;
  }
}

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE, updateAge: 60 * 60 * 24 },
  pages: { signIn: "/login", error: "/login" },
  logger: {
    // Failed sign-ins are expected and already audited; don't flood logs with stack traces.
    error(error) {
      if (error.name === "CredentialsSignin" || (error as { type?: string }).type === "CredentialsSignin") return;
      console.error("[auth]", error);
    },
  },
  trustHost: process.env.AUTH_TRUST_HOST === "true" || process.env.NODE_ENV !== "production",
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const ip = clientIpFrom(request.headers);
        const [byIp, byEmail] = await Promise.all([
          rateLimit(`login:ip:${ip}`, RATE_LIMITS.login),
          rateLimit(`login:email:${email}`, RATE_LIMITS.loginGlobalEmail),
        ]);
        if (!byIp.success || !byEmail.success) throw new RateLimitedSignin();

        const user = await db.user.findUnique({ where: { email } });
        const valid = await verifyPassword(password, user?.passwordHash);
        if (!user || !valid) {
          await db.auditLog.create({ data: { action: "auth.login_failed", metadata: { email }, ip } }).catch(() => {});
          return null;
        }

        await Promise.all([
          resetRateLimit(`login:ip:${ip}`),
          resetRateLimit(`login:email:${email}`),
          db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
          db.auditLog.create({ data: { action: "auth.login", actorId: user.id, ip } }),
        ]);

        return { id: user.id, name: user.name, email: user.email, role: user.role, sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.sv = user.sessionVersion ?? 0;
        return token;
      }
      if (!token.uid) return null;
      // Re-validate against the database so revoked sessions (password change,
      // "sign out everywhere", deleted user) stop working immediately.
      const current = await db.user.findUnique({
        where: { id: token.uid },
        select: { role: true, sessionVersion: true, name: true, email: true },
      });
      if (!current || current.sessionVersion !== token.sv) return null;
      token.role = current.role;
      token.name = current.name;
      token.email = current.email;
      return token;
    },
    session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid;
        session.user.role = token.role ?? "EDITOR";
      }
      return session;
    },
  },
});
