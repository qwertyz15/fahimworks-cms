import type { Instrumentation } from "next";

/**
 * Every error thrown while rendering a page, running a server action or an
 * API route is recorded (and alerts your phone when it's new). Node runtime
 * only: the database isn't available at the edge.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const err = error as Error & { digest?: string };
  // Not errors: redirects and 404s use thrown signals.
  if (typeof err?.digest === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(err.digest)) return;
  const { recordError } = await import("@/server/services/errors");
  await recordError({
    source: "server",
    message: err?.message ?? String(error),
    stack: err?.stack,
    route: `${request.method} ${context.routePath} (${context.routeType})`,
    digest: err?.digest,
  });
};
