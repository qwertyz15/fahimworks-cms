import "server-only";

/**
 * Push alerts to your phone with ntfy (https://ntfy.sh): install the app,
 * subscribe to a private topic name, and set ALERT_NTFY_TOPIC to it.
 * Optional: ALERT_NTFY_SERVER (self-hosted ntfy), ALERT_NTFY_TOKEN (access token).
 */

export function alertsConfigured() {
  return Boolean(process.env.ALERT_NTFY_TOPIC?.trim());
}

export async function sendAlert(a: { title: string; message: string; priority?: "default" | "high" | "urgent"; tags?: string[]; click?: string }): Promise<boolean> {
  const topic = process.env.ALERT_NTFY_TOPIC?.trim();
  if (!topic || !/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return false;
  const server = (process.env.ALERT_NTFY_SERVER?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
  const token = process.env.ALERT_NTFY_TOKEN?.trim();
  // Header values must be plain ASCII.
  const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").slice(0, 250);
  try {
    const res = await fetch(`${server}/${topic}`, {
      method: "POST",
      body: a.message.slice(0, 3500),
      headers: {
        Title: ascii(a.title),
        Priority: a.priority ?? "default",
        ...(a.tags?.length ? { Tags: ascii(a.tags.join(",")) } : {}),
        ...(a.click ? { Click: ascii(a.click) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
