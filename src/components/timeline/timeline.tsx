"use client";

/* eslint-disable @next/next/no-img-element -- remote thumbnails from arbitrary hosts */
import { useMemo, useState } from "react";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";
import type { ContentType } from "@/generated/prisma/enums";
import { cn, displayHost } from "@/lib/utils";
import { TYPE_META, TYPE_ORDER } from "@/components/dashboard/content-types";
import type { TimelineItem as BaseItem } from "@/server/queries/public";

/** A timeline item plus where it opens: the original page (imported) or its article page (Notebook). */
export type TimelineItem = BaseItem & { href: string; external: boolean };

/** Link props: imported work opens in a new tab, Notebook articles in the same tab. */
function linkProps(item: TimelineItem) {
  return item.external ? { href: item.href, target: "_blank", rel: "noopener noreferrer" } : { href: item.href };
}

const monthDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric" });

function itemDate(item: TimelineItem): Date | null {
  const d = item.publishDate ?? item.publishedAt;
  return d ? new Date(d) : null;
}

function TypeLabel({ type, className }: { type: ContentType; className?: string }) {
  const meta = TYPE_META[type];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.tile, className)}>
      <meta.icon className="size-3" /> {meta.label}
    </span>
  );
}

function Placeholder({ type }: { type: ContentType }) {
  const meta = TYPE_META[type];
  return (
    <div className={cn("flex size-full items-center justify-center", meta.tile)} aria-hidden>
      <meta.icon className="size-8 opacity-70" />
    </div>
  );
}

function FeaturedCard({ item, large }: { item: TimelineItem; large?: boolean }) {
  const date = itemDate(item);
  const summary = item.summary ?? item.description;
  return (
    <a
      {...linkProps(item)}
      className={cn(
        "group reveal relative flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-card transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-pop",
        large && "sm:col-span-2 sm:flex-row",
      )}
    >
      <div className={cn("relative overflow-hidden bg-muted", large ? "aspect-[16/9] sm:aspect-auto sm:w-3/5" : "aspect-[16/9]")}>
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        ) : (
          <Placeholder type={item.type} />
        )}
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
          <Sparkles className="size-3 text-primary" /> Featured
        </span>
      </div>
      <div className={cn("flex flex-1 flex-col gap-3 p-5", large && "sm:justify-center sm:p-7")}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <TypeLabel type={item.type} />
          {date && <time dateTime={date.toISOString()}>{fullDate.format(date)}</time>}
        </div>
        <h3 className={cn("flex items-start gap-1.5 leading-snug font-semibold tracking-tight group-hover:text-primary", large ? "text-xl sm:text-2xl" : "text-lg")}>
          <span>{item.title}</span>
          <ArrowUpRight className="mt-1 size-4 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
        </h3>
        {summary && <p className={cn("text-sm leading-relaxed text-muted-foreground", large ? "line-clamp-4" : "line-clamp-3")}>{summary}</p>}
        {item.url && <p className="mt-auto text-xs text-muted-foreground">{item.siteName ?? displayHost(item.url)}</p>}
      </div>
    </a>
  );
}

function Entry({ item }: { item: TimelineItem }) {
  const date = itemDate(item);
  const summary = item.summary ?? item.description;
  const meta = TYPE_META[item.type];
  return (
    <li className="reveal relative pl-8">
      {/* Rail dot, coloured by type */}
      <span className={cn("absolute top-6 left-0 size-3 -translate-x-1/2 rounded-full ring-4 ring-background", meta.dot)} aria-hidden />
      <a
        {...linkProps(item)}
        className="group flex gap-5 rounded-2xl border border-transparent p-4 transition duration-300 hover:-translate-y-0.5 hover:border-border hover:bg-surface hover:shadow-card sm:p-5"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            {date && (
              <time dateTime={date.toISOString()} title={fullDate.format(date)} className="font-medium text-foreground/70">
                {monthDay.format(date)}
              </time>
            )}
            <TypeLabel type={item.type} />
            {item.url && <span>{item.siteName ?? displayHost(item.url)}</span>}
            {item.readingMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {item.readingMinutes} min read
              </span>
            ) : null}
          </div>
          <h3 className="flex items-start gap-1.5 text-base leading-snug font-semibold tracking-tight group-hover:text-primary sm:text-lg">
            <span>{item.title}</span>
            <ArrowUpRight className="mt-1 size-4 shrink-0 opacity-40 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
          </h3>
          {summary && <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{summary}</p>}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {item.tags.slice(0, 5).map((t) => (
                <span key={t.slug} className="rounded-full border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
        {item.thumbnail && (
          <div className="hidden h-24 w-36 shrink-0 overflow-hidden rounded-xl border bg-muted sm:block">
            <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
          </div>
        )}
      </a>
    </li>
  );
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  const [active, setActive] = useState<ContentType | undefined>();
  const counts = useMemo(() => Object.fromEntries(TYPE_ORDER.map((t) => [t, items.filter((i) => i.type === t).length])), [items]);
  const visible = useMemo(() => (active ? items.filter((i) => i.type === active) : items), [items, active]);
  const featured = useMemo(() => items.filter((i) => i.featured).slice(0, 3), [items]);

  const years = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of visible) {
      const d = itemDate(item);
      const key = d ? String(d.getFullYear()) : "Undated";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [visible]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-surface/50 px-6 py-20 text-center">
        <p className="font-medium">Nothing published yet</p>
        <p className="mt-1 text-sm text-muted-foreground">New writing and projects will appear here.</p>
      </div>
    );
  }

  const tabs = [
    { key: undefined, label: "All", count: items.length },
    ...TYPE_ORDER.filter((t) => counts[t]).map((t) => ({ key: t, label: TYPE_META[t].plural, count: counts[t]! })),
  ];

  return (
    <div className="space-y-16">
      {featured.length > 0 && !active && (
        <section aria-labelledby="featured-heading" className="space-y-5">
          <h2 id="featured-heading" className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Featured
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {featured.map((item, i) => (
              <FeaturedCard key={item.id} item={item} large={i === 0 && featured.length !== 2} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="all-heading" className="space-y-8">
        <div className="sticky top-3 z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="all-heading" className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            All work
          </h2>
          <div role="tablist" aria-label="Filter by type" className="flex max-w-full gap-1 overflow-x-auto rounded-full border bg-surface/85 p-1 shadow-card backdrop-blur">
            {tabs.map((tab) => {
              const selected = tab.key === active;
              return (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(tab.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                    selected ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <span className={cn("tabular-nums text-[11px]", selected ? "opacity-70" : "opacity-60")}>{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-12">
          {years.map(([year, entries]) => (
            <div key={year} className="grid gap-4 md:grid-cols-[7rem_1fr] md:gap-8">
              <div className="md:sticky md:top-20 md:self-start">
                <h3 className="pt-4 text-lg font-semibold tracking-tight text-foreground/75 tabular-nums sm:pt-5">{year}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {entries.length} {entries.length === 1 ? "piece" : "pieces"}
                </p>
              </div>
              <ol className="relative ml-1.5 space-y-2 border-l border-border md:ml-0">
                {entries.map((item) => (
                  <Entry key={item.id} item={item} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
