import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Clock, FolderOpen } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { folderPageUrl, isTimelineHost } from "@/lib/timeline";
import { getPublicFolder, type PublicFolderSection } from "@/server/queries/folders-public";
import { getSettings } from "@/server/services/settings";

/** Public page of a Notebook folder: its published entries in order, subfolders as sections. */

const shortDate = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });

async function load(slug: string) {
  if (slug.length > 80) return null;
  const [settings, folder] = await Promise.all([getSettings(), getPublicFolder(slug)]);
  if (!settings.timelineEnabled || !folder) return null;
  return { settings, folder, author: settings.profileName?.trim() || settings.siteName };
}

export async function generateMetadata({ params }: PageProps<"/timeline/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Not found", robots: { index: false, follow: false } };
  const { folder, settings, author } = data;
  const description = folder.description ?? `${folder.total} ${folder.total === 1 ? "article" : "articles"} by ${author}.`;
  return {
    title: { absolute: `${folder.name} · ${author}` },
    description,
    alternates: { canonical: folderPageUrl(folder.slug) },
    robots: settings.timelineIndexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { type: "website", title: folder.name, description, url: folderPageUrl(folder.slug) },
  };
}

export default async function FolderPage({ params }: PageProps<"/timeline/c/[slug]">) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { folder, author } = data;
  const h = await headers();
  const onTimelineHost = isTimelineHost(h.get("x-forwarded-host") ?? h.get("host"));
  const base = onTimelineHost ? "" : "/timeline";
  const home = onTimelineHost ? "/" : "/timeline";
  let n = 0;

  const Section = ({ s, level }: { s: PublicFolderSection; level: number }) => (
    <section className={level === 0 ? "" : level === 1 ? "mt-10" : "mt-6 border-l pl-4 sm:pl-5"} aria-labelledby={`sec-${s.id}`}>
      {level > 0 && (
        <h2 id={`sec-${s.id}`} className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden>{s.icon ?? <FolderOpen className="size-4 text-muted-foreground" />}</span>
          <Link href={`${base}/c/${s.slug}`} className="hover:underline">
            {s.name}
          </Link>
        </h2>
      )}
      {level > 0 && s.description && <p className="-mt-1 mb-3 text-sm text-muted-foreground">{s.description}</p>}
      {s.entries.length > 0 && (
        <ol className="divide-y overflow-hidden rounded-2xl border bg-surface/70 shadow-card" data-testid="folder-entries">
          {s.entries.map((e) => {
            n += 1;
            const date = e.publishDate ?? e.publishedAt;
            return (
              <li key={e.id}>
                <Link href={`${base}/p/${e.slug}`} className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-2/70">
                  <span className="mt-0.5 w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{n}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium group-hover:underline">{e.title}</span>
                    {(e.subtitle ?? e.summary) && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{e.subtitle ?? e.summary}</span>}
                    <span className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {date && <time dateTime={new Date(date).toISOString()}>{shortDate.format(new Date(date))}</time>}
                      {e.readingMinutes ? <span>{e.readingMinutes} min read</span> : null}
                    </span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {s.sections.map((c) => (
        <Section key={c.id} s={c} level={level + 1} />
      ))}
    </section>
  );

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[22rem]">
        <div className="dot-grid absolute inset-0 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,black,transparent)]" />
      </div>
      <div className="relative mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-6">
        <nav className="flex items-center justify-between">
          <Link href={home} className="inline-flex items-center gap-1.5 rounded-full border bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All work
          </Link>
          <ThemeToggle />
        </nav>
        <header className="mt-12 mb-10 space-y-4 sm:mt-16">
          {folder.trail.length > 0 && (
            <p className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground" aria-label="Folder path">
              {folder.trail.map((t) => (
                <span key={t.slug} className="inline-flex items-center gap-1">
                  <Link href={`${base}/c/${t.slug}`} className="hover:text-foreground hover:underline">
                    {t.icon} {t.name}
                  </Link>
                  <ChevronRight className="size-3" />
                </span>
              ))}
            </p>
          )}
          <h1 className="flex items-center gap-3 text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
            {folder.icon && <span aria-hidden>{folder.icon}</span>}
            {folder.name}
          </h1>
          {folder.description && <p className="text-lg leading-relaxed text-muted-foreground text-pretty">{folder.description}</p>}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">By {author}</span>
            <span>
              {folder.total} {folder.total === 1 ? "article" : "articles"}
            </span>
            {folder.minutes > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" /> {folder.minutes} min read in total
              </span>
            )}
          </p>
        </header>
        {folder.total === 0 ? <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nothing published here yet.</p> : <Section s={folder} level={0} />}
      </div>
    </div>
  );
}
