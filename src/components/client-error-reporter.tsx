"use client";

import { useEffect } from "react";

/** Sends browser errors in the dashboard to /api/errors (a few per minute at most). */
export function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();
    const reset = setInterval(() => (sent = 0), 60_000);
    const report = (message: string, stack?: string) => {
      // Noise from extensions / the browser itself.
      if (!message || /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:/.test(message)) return;
      const key = message.slice(0, 200);
      if (seen.has(key) || sent >= 5) return;
      seen.add(key);
      sent++;
      void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message.slice(0, 2000), stack: stack?.slice(0, 8000), url: location.href.slice(0, 500) }), keepalive: true }).catch(() => {});
    };
    const onError = (e: ErrorEvent) => report(e.message, e.error instanceof Error ? e.error.stack : undefined);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as unknown;
      report(r instanceof Error ? r.message : typeof r === "string" ? r : "Unhandled promise rejection", r instanceof Error ? r.stack : undefined);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      clearInterval(reset);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
