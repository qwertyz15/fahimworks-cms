import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe, Mail, Rss } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { GithubIcon, LinkedinIcon, XIcon } from "@/components/timeline/brand-icons";
import { Timeline } from "@/components/timeline/timeline";
import { timelineUrl } from "@/lib/timeline";
import { getTimelineItems } from "@/server/queries/public";
import { getSettings } from "@/server/services/settings";

/** Public, read-only page: every PUBLISHED item, grouped by year. */

async function profile() {
  const s = await getSettings();
  const name = s.profileName?.trim() || s.siteName;
  const tagline = s.profileTagline?.trim() || null;
  return { s, name, tagline, description: tagline ?? `Blogs, tutorials, articles and projects by ${name}.` };
}

export async function generateMetadata(): Promise<Metadata> {
  const { s, name, description } = await profile();
  if (!s.timelineEnabled) return { title: "Not found", robots: { index: false, follow: false } };
  const items = await getTimelineItems();
  const image = items.find((i) => i.featured && i.thumbnail)?.thumbnail ?? items.find((i) => i.thumbnail)?.thumbnail;
  const url = timelineUrl();
  return {
    title: { absolute: `${name} · Timeline` },
    description,
    alternates: { canonical: url },
    robots: s.timelineIndexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", title: `${name} · Timeline`, description, url, images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title: `${name} · Timeline`, description, images: image ? [image] : undefined },
  };
}

export default async function TimelinePage() {
  const { s, name, tagline } = await profile();
  if (!s.timelineEnabled) notFound();
  const items = await getTimelineItems();

  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const years = items.flatMap((i) => {
    const d = i.publishDate ?? i.publishedAt;
    return d ? [new Date(d).getFullYear()] : [];
  });
  const since = years.length ? Math.min(...years) : null;

  const links = [
    s.profileGithub && { href: s.profileGithub, label: "GitHub", icon: GithubIcon },
    s.profileLinkedin && { href: s.profileLinkedin, label: "LinkedIn", icon: LinkedinIcon },
    s.profileX && { href: s.profileX, label: "X", icon: XIcon },
    s.profileWebsite && { href: s.profileWebsite, label: "Website", icon: Globe },
    s.profileEmail && { href: `mailto:${s.profileEmail}`, label: "Email", icon: Mail },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Globe }[];

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <header className="mt-6 mb-12 space-y-5">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-500 text-xl font-semibold text-primary-foreground shadow-pop" aria-hidden>
            {initials}
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{name}</h1>
            {tagline && <p className="max-w-xl text-base text-muted-foreground sm:text-lg">{tagline}</p>}
            <p className="text-sm text-muted-foreground">
              {items.length} piece{items.length === 1 ? "" : "s"} of work{since ? ` since ${since}` : ""}
            </p>
          </div>
          {links.length > 0 && (
            <nav aria-label="Profiles" className="flex flex-wrap gap-2">
              {links.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target={l.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noopener noreferrer me"
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-surface px-3 py-1.5 text-[13px] font-medium text-muted-foreground shadow-card transition-colors hover:text-foreground"
                >
                  <l.icon className="size-3.5" /> {l.label}
                </a>
              ))}
            </nav>
          )}
        </header>

        <Timeline items={items} />

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-xs text-muted-foreground">
          <span>
            © {new Date().getFullYear()} {name}
          </span>
          {s.publicApiEnabled && (
            <a href="/feed.xml" className="inline-flex items-center gap-1 hover:text-foreground">
              <Rss className="size-3.5" /> RSS
            </a>
          )}
        </footer>
      </div>
    </div>
  );
}
