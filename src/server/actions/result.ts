import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { SafeFetchError } from "@/lib/http/safe-fetch";
import { RATE_LIMITS, RateLimitError, enforceRateLimit, type RateLimitRule } from "@/lib/rate-limit";
import { fieldErrors } from "@/lib/validation";
import { AuthorizationError, requireAdmin, type SessionUser } from "@/server/auth/guards";
import { ContentError } from "@/server/services/content";
import { WorkflowError } from "@/server/services/workflow";
import { StorageError } from "@/lib/storage";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const idle: ActionResult<never> = { ok: false, error: "" };

const EXPECTED = [AuthorizationError, RateLimitError, ContentError, WorkflowError, SafeFetchError, StorageError];

export function toActionError(err: unknown): ActionResult<never> {
  unstable_rethrow(err); // let redirect()/notFound() propagate
  if (err instanceof z.ZodError) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(err) };
  if (EXPECTED.some((E) => err instanceof E)) return { ok: false, error: (err as Error).message };
  console.error("[action] unexpected error", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Wrap an admin-only server action: authorisation (re-checked on every call,
 * Server Actions are public HTTP endpoints), per-user rate limiting, and
 * uniform error mapping.
 */
export async function adminAction<T>(
  fn: (user: SessionUser) => Promise<ActionResult<T>>,
  opts: { rateLimit?: { key: string; rule: RateLimitRule } } = {},
): Promise<ActionResult<T>> {
  try {
    const user = await requireAdmin("throw");
    await enforceRateLimit(`mutation:${user.id}`, RATE_LIMITS.mutation);
    if (opts.rateLimit) await enforceRateLimit(`${opts.rateLimit.key}:${user.id}`, opts.rateLimit.rule);
    return await fn(user);
  } catch (err) {
    return toActionError(err);
  }
}

export function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
