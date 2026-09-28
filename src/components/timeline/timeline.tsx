"use client";

/* eslint-disable @next/next/no-img-element -- remote thumbnails from arbitrary hosts */
import { useMemo, useState } from "react";
import { ArrowUpRight, Clock, Star } from "lucide-react";
import type { ContentType } from "@/generated/prisma/enums";
import { cn, displayHost } from "@/lib/utils";
import { TYPE_META, TYPE_ORDER } from "@/components/dashboard/content-types";
import type { TimelineItem } from "@/server/queries/public";

const monthDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric" });

function itemDate(item: TimelineItem): Date | null {
  const d = item.publishDate ?? item.publishedAt;
  return d ? new Date(d) : null;
}

function TypeLabel({ type }: { type: ContentType }) {
  const meta = TYPE_META[type];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", meta.tile)}>
      <meta.icon className="size-3" /> {meta.label}
    </span>
  );
}

function FeaturedCard({ item }: { item: TimelineItem }) {
  const date = itemDate(item);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop"
    >
      {item.thumbnail && (
        <div className="aspect-[16/8] overflow-hidden border-b bg-muted">
          <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <TypeLabel type={item.type} />
          {date && <time dateTime={date.toISOString()} className="text-xs text-muted-foreground">{fullDate.format(date)}</time>}
        </div>
        <h3 className="flex items-start gap-1 leading-snug font-semibold group-hover:text-primary">
          <span className="line-clamp-2">{item.title}</span>
          <ArrowUpRight className="mt-0.5 size-4 shrink-0 opacity-50 transition group-hover:opacity-100" />
        </h3>
        {(item.summary ?? item.description) && <p className="line-clamp-3 text-sm text-muted-foreground">{item.summary ?? item.description}</p>}
      </div>
    </a>
  );
}

function Entry({ item }: { item: TimelineItem }) {
  const date = itemDate(item);
  const summary = item.summary ?? item.description;
  return (
    <li className="relative pl-8">
      {/* rail dot */}
      <span className="absolute top-2 left-[3px] size-2.5 rounded-full border-2 border-background bg-primary ring-1 ring-primary/30" aria-hidden />
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="group -mx-3 flex gap-4 rounded-xl p-3 transition-colors hover:bg-surface-2/80">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {date && <time dateTime={date.toISOString()} title={fullDate.format(date)}>{monthDay.format(date)}</time>}
            <TypeLabel type={item.type} />
            <span>{item.siteName ?? displayHost(item.url)}</span>
            {item.readingMinutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {item.readingMinutes} min
              </span>
            ) : null}
          </div>
          <h3 className="flex items-start gap-1 leading-snug font-semibold group-hover:text-primary">
            <span>{item.title}</span>
            <ArrowUpRight className="mt-0.5 size-4 shrink-0 opacity-40 transition group-hover:opacity-100" />
          </h3>
          {summary && <p className="line-clamp-2 text-sm text-muted-foreground">{summary}</p>}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {item.tags.slice(0, 5).map((t) => (
                <span key={t.slug} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
        {item.thumbnail && (
          <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="hidden h-20 w-32 shrink-0 rounded-lg border bg-muted object-cover sm:block" />
        )}
      </a>
    </li>
  );
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  const [active, setActive] = useState<ContentType | undefined>();
  const counts = useMemo(() => Object.fromEntries(TYPE_ORDER.map((t) => [t, items.filter((i) => i.type === t).length])), [items]);
  const visible = useMemo(() => (active ? items.filter((i) => i.type === active) : items), [items, active]);
  const featured = useMemo(() => items.filter((i) => i.featured).slice(0, 4), [items]);

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
    return <p className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">Nothing published yet — check back soon.</p>;
  }

  const tabs = [{ key: undefined, label: "All", count: items.length }, ...TYPE_ORDER.filter((t) => counts[t]).map((t) => ({ key: t, label: TYPE_META[t].plural, count: counts[t]! }))];

  return (
    <div className="space-y-12">
      {featured.length > 0 && !active && (
        <section aria-labelledby="featured-heading" className="space-y-4">
          <h2 id="featured-heading" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Star className="size-4" /> Featured
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {featured.map((item) => (
              <FeaturedCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      <section aria-label="All work" className="space-y-6">
        <div role="tablist" aria-label="Filter by type" className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto bg-background/85 px-4 py-2 backdrop-blur">
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
                  selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {tab.label}
                <span className={cn("text-[11px] tabular-nums", selected ? "opacity-70" : "opacity-60")}>{tab.count}</span>
              </button>
            );
          })}
        </div>

        {years.map(([year, entries]) => (
          <div key={year} className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight tabular-nums">{year}</h2>
            <ol className="relative space-y-1 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-border">
              {entries.map((item) => (
                <Entry key={item.id} item={item} />
              ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}
