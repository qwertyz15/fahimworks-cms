/**
 * Where the public timeline lives. With TIMELINE_HOST set (e.g.
 * "timeline.fahimworks.dev") that host serves only the timeline; the page is
 * also always available at /timeline on the main domain.
 */
export function timelineHost(): string | null {
  const host = process.env.TIMELINE_HOST?.trim().toLowerCase();
  return host ? host.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
}

export function isTimelineHost(host: string | null | undefined): boolean {
  const configured = timelineHost();
  if (!host || !configured) return false;
  return host.toLowerCase().split(":")[0] === configured;
}

/** Public address to link to / share. */
export function timelineUrl(): string {
  const host = timelineHost();
  if (host) return `https://${host}`;
  return `${(process.env.AUTH_URL ?? "").replace(/\/+$/, "")}/timeline`;
}
