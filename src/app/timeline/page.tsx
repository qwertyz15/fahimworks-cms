import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe, Mail, Rss } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { GithubIcon, LinkedinIcon, XIcon } from "@/components/timeline/brand-icons";
import { Timeline, type TimelineItem as TimelineItemWithLink } from "@/components/timeline/timeline";
import { headers } from "next/headers";
import { isTimelineHost, timelineUrl } from "@/lib/timeline";
import { TYPE_META, TYPE_ORDER } from "@/components/dashboard/content-types";
import { getTimelineItems } from "@/server/queries/public";
import { getSettings } from "@/server/services/settings";

/** Public, read-only page: every PUBLISHED item, grouped by year. */

async function profile() {
  const s = await getSettings();
  const name = s.profileName?.trim() || s.siteName;
  const tagline = s.profileTagline?.trim() || null;
  return { s, name, tagline, description: tagline ?? `Blogs, tutorials, articles, notes and projects by ${name}.` };
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

type ProfileLink = { href: string; label: string; icon: typeof Globe };

function ProfileLinks({ links, compact }: { links: ProfileLink[]; compact?: boolean }) {
  if (!links.length) return null;
  return (
    <nav aria-label={compact ? "Profiles (footer)" : "Profiles"} className="flex flex-wrap gap-2">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target={l.href.startsWith("mailto:") ? undefined : "_blank"}
          rel="noopener noreferrer me"
          className={
            compact
              ? "inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              : "inline-flex items-center gap-2 rounded-full border bg-surface/80 px-4 py-2 text-sm font-medium text-foreground/80 shadow-card backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/40 hover:text-foreground"
          }
        >
          <l.icon className={compact ? "size-3.5" : "size-4"} /> {l.label}
        </a>
      ))}
    </nav>
  );
}

export default async function TimelinePage() {
  const { s, name, tagline } = await profile();
  if (!s.timelineEnabled) notFound();
  // Notebook articles live at /p/<slug> on the timeline host, /timeline/p/<slug> elsewhere.
  const h = await headers();
  const base = isTimelineHost(h.get("x-forwarded-host") ?? h.get("host")) ? "" : "/timeline";
  const items: TimelineItemWithLink[] = (await getTimelineItems()).map((i) => ({
    ...i,
    href: i.url ?? `${base}/p/${i.slug}`,
    external: Boolean(i.url),
  }));

  const years = items.flatMap((i) => {
    const d = i.publishDate ?? i.publishedAt;
    return d ? [new Date(d).getFullYear()] : [];
  });
  const since = years.length ? Math.min(...years) : null;
  const typeSummary = TYPE_ORDER.map((t) => {
    const n = items.filter((i) => i.type === t).length;
    if (!n) return null;
    // "3 notebook posts" reads better than "3 Notebook".
    if (t === "NOTEBOOK") return `${n} notebook ${n === 1 ? "post" : "posts"}`;
    return `${n} ${n === 1 ? TYPE_META[t].label : TYPE_META[t].plural}`;
  }).filter(Boolean);

  const links = [
    s.profileGithub && { href: s.profileGithub, label: "GitHub", icon: GithubIcon },
    s.profileLinkedin && { href: s.profileLinkedin, label: "LinkedIn", icon: LinkedinIcon },
    s.profileX && { href: s.profileX, label: "X", icon: XIcon },
    s.profileWebsite && { href: s.profileWebsite, label: "Website", icon: Globe },
    s.profileEmail && { href: `mailto:${s.profileEmail}`, label: "Email", icon: Mail },
  ].filter(Boolean) as ProfileLink[];

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background">
      {/* Decorative backdrop: soft glow + dot grid, fading out below the header. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[36rem]">
        <div className="dot-grid absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[56rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--color-primary)_28%,transparent),transparent)] blur-2xl" />
        <div className="absolute -top-24 left-[62%] h-72 w-72 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,#ec4899_20%,transparent),transparent)] blur-2xl" />
      </div>

      <div className="relative mx-auto w-full max-w-4xl px-4 pt-6 pb-20 sm:px-6">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <header className="animate-fade-up mt-10 mb-16 space-y-6 sm:mt-16">
          <p className="inline-flex items-center gap-2 rounded-full border bg-surface/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Writing &amp; projects timeline
          </p>
          <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/55 bg-clip-text pb-1 text-5xl font-semibold tracking-tight text-transparent sm:text-6xl md:text-7xl">
            {name}
          </h1>
          {tagline && <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">{tagline}</p>}
          {(typeSummary.length > 0 || since) && (
            <p className="text-sm text-muted-foreground">
              {typeSummary.join(" · ")}
              {since && <> · since {since}</>}
            </p>
          )}
          <ProfileLinks links={links} />
        </header>

        <Timeline items={items} />

        <footer className="mt-24 flex flex-col gap-4 border-t pt-8 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} · All work links to its original source.</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ProfileLinks links={links} compact />
            {s.publicApiEnabled && (
              <a href="/feed.xml" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <Rss className="size-3.5" /> RSS
              </a>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
