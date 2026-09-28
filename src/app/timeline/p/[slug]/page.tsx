/* eslint-disable @next/next/no-img-element -- cover images from the media bucket */
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { TYPE_META } from "@/components/dashboard/content-types";
import { ThemeToggle } from "@/components/theme-toggle";
import { CodeCopy } from "@/components/timeline/code-copy";
import { cn } from "@/lib/utils";
import { isTimelineHost, writtenPostUrl } from "@/lib/timeline";
import { getPublishedArticle } from "@/server/queries/public";
import { getSettings } from "@/server/services/settings";

/** Public article page for a published Notebook entry: timeline.fahimworks.dev/p/<slug>. */

const longDate = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric" });

async function load(slug: string) {
  if (slug.length > 120) return null;
  const [settings, article] = await Promise.all([getSettings(), getPublishedArticle(slug)]);
  if (!settings.timelineEnabled || !article) return null;
  return { settings, article, author: settings.profileName?.trim() || settings.siteName };
}

export async function generateMetadata({ params }: PageProps<"/timeline/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Not found", robots: { index: false, follow: false } };
  const { article, settings, author } = data;
  const description = article.summary ?? article.subtitle ?? undefined;
  const url = writtenPostUrl(article.slug);
  const published = article.publishDate ?? article.publishedAt;
  return {
    title: { absolute: `${article.title} · ${author}` },
    description,
    alternates: { canonical: url },
    robots: settings.timelineIndexable ? { index: true, follow: true } : { index: false, follow: false },
    authors: [{ name: author }],
    openGraph: {
      type: "article",
      title: article.title,
      description,
      url,
      publishedTime: published ? new Date(published).toISOString() : undefined,
      authors: [author],
      tags: article.tags.map((t) => t.name),
      images: article.thumbnail ? [{ url: article.thumbnail }] : undefined,
    },
    twitter: { card: article.thumbnail ? "summary_large_image" : "summary", title: article.title, description, images: article.thumbnail ? [article.thumbnail] : undefined },
  };
}

export default async function ArticlePage({ params }: PageProps<"/timeline/p/[slug]">) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { article, author } = data;

  const h = await headers();
  const home = isTimelineHost(h.get("x-forwarded-host") ?? h.get("host")) ? "/" : "/timeline";
  const meta = TYPE_META[article.type];
  const published = article.publishDate ?? article.publishedAt;

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[26rem]">
        <div className="dot-grid absolute inset-0 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute -top-44 left-1/2 h-[24rem] w-[48rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--color-primary)_22%,transparent),transparent)] blur-2xl" />
      </div>

      <div className="relative mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-6">
        <nav className="flex items-center justify-between">
          <Link href={home} className="inline-flex items-center gap-1.5 rounded-full border bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All work
          </Link>
          <ThemeToggle />
        </nav>

        <header className="animate-fade-up mt-12 mb-10 space-y-5 sm:mt-16">
          <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", meta.tile)}>
              <meta.icon className="size-3" /> {meta.label}
            </span>
            {published && <time dateTime={new Date(published).toISOString()}>{longDate.format(new Date(published))}</time>}
            {article.readingMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" /> {article.readingMinutes} min read
              </span>
            ) : null}
          </div>
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">{article.title}</h1>
          {article.subtitle && <p className="text-xl leading-relaxed text-muted-foreground text-pretty">{article.subtitle}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-5 text-sm">
            <span className="font-medium">By {author}</span>
            {article.tags.length > 0 && (
              <span className="flex flex-wrap gap-1.5">
                {article.tags.map((t) => (
                  <span key={t.slug} className="rounded-full border bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">
                    {t.name}
                  </span>
                ))}
              </span>
            )}
          </div>
        </header>

        {article.coverImage && (
          <img src={article.coverImage} alt="" referrerPolicy="no-referrer" className="mb-10 aspect-[16/9] w-full rounded-2xl border object-cover shadow-card" />
        )}

        {/* contentHtml is sanitised with a strict allowlist on every save (services/notebook-html.ts). */}
        <article id="article-body" className="prose-content prose-article" dangerouslySetInnerHTML={{ __html: article.contentHtml ?? "" }} />
        <CodeCopy selector="#article-body" />

        <footer className="mt-20 flex flex-col gap-4 border-t pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">{author}</p>
            <p className="text-xs text-muted-foreground">Thanks for reading.</p>
          </div>
          <Link href={home} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <ArrowLeft className="size-3.5" /> More work
          </Link>
        </footer>
      </div>
    </div>
  );
}
