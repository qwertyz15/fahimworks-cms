import "server-only";
import { env } from "@/lib/env";

/**
 * Screenshot URL for the preview, built from SCREENSHOT_URL_TEMPLATE
 * (e.g. "https://image.thum.io/get/width/1280/{url}"). The browser loads it
 * directly, so no screenshot bytes pass through this server. Returns null when
 * no provider is configured; the UI falls back to the Open Graph image.
 */
export function screenshotUrl(pageUrl: string): string | null {
  const template = env().SCREENSHOT_URL_TEMPLATE.trim();
  if (!template || !template.includes("{url}")) return null;
  try {
    const built = new URL(template.replace("{url}", encodeURIComponent(pageUrl)));
    return built.protocol === "https:" ? built.href : null;
  } catch {
    return null;
  }
}
