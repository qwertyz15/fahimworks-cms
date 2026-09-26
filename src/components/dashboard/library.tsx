"use client";

/* eslint-disable @next/next/no-img-element -- remote images from arbitrary hosts */
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, PlusCircle } from "lucide-react";
import type { ContentType } from "@/generated/prisma/enums";
import { StatusBadge } from "@/components/content/badges";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { cn, displayHost, formatDate } from "@/lib/utils";
import type { LibraryItem } from "@/server/queries/content";
import { TYPE_META, TYPE_ORDER, type LibraryView } from "./content-types";
import { ViewToggle, persistView } from "./view-toggle";

function TypeIconTile({ type, className }: { type: ContentType; className?: string }) {
  const meta = TYPE_META[type];
  return (
    <div className={cn("flex items-center justify-center rounded-md", meta.tile, className)} aria-hidden>
      <meta.icon className="size-1/3 min-h-4 min-w-4" />
    </div>
  );
}

function GridCard({ item }: { item: LibraryItem }) {
  const meta = TYPE_META[item.type];
  return (
    <Link
      href={`/dashboard/content/${item.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop focus-visible:border-primary"
    >
      <div className="relative aspect-[16/9] overflow-hidden border-b bg-muted">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <TypeIconTile type={item.type} className="size-full rounded-none" />
        )}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] font-medium shadow-sm backdrop-blur">
          <meta.icon className="size-3" /> {meta.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className="line-clamp-2 text-sm leading-snug font-medium group-hover:text-primary">{item.title}</p>
        {item.description && <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <StatusBadge status={item.status} />
          <span className="truncate text-[11px] text-muted-foreground">{formatDate(item.publishDate ?? item.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function ListRows({ items }: { items: LibraryItem[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-card">
      <div className="hidden grid-cols-[minmax(0,1fr)_7rem_11rem_9rem_7rem] gap-4 border-b bg-surface-2/60 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
        <span>Name</span>
        <span>Type</span>
        <span>Status</span>
        <span>Site</span>
        <span className="text-right">Modified</span>
      </div>
      <ul className="divide-y">
        {items.map((item) => {
          const meta = TYPE_META[item.type];
          return (
            <li key={item.id}>
              <Link
                href={`/dashboard/content/${item.id}`}
                className="group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_7rem_11rem_9rem_7rem] md:gap-4"
              >
                <span className="flex min-w-0 items-center gap-3 max-md:contents">
                  <TypeIconTile type={item.type} className="size-8 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium group-hover:text-primary">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground md:hidden">
                      {meta.label} · {displayHost(item.url)} · {formatDate(item.updatedAt)}
                    </span>
                  </span>
                </span>
                <span className="hidden items-center gap-1.5 text-[13px] text-muted-foreground md:flex">
                  <meta.icon className="size-3.5" /> {meta.label}
                </span>
                <span className="hidden md:block">
                  <StatusBadge status={item.status} />
                </span>
                <span className="hidden truncate text-[13px] text-muted-foreground md:block">{item.siteName ?? displayHost(item.url)}</span>
                <span className="hidden text-right text-[13px] whitespace-nowrap text-muted-foreground md:block">{formatDate(item.updatedAt)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Keep the address bar in sync (shareable/filter-able) without a server round trip. */
function syncUrl(type?: ContentType) {
  const url = new URL(window.location.href);
  if (type) url.searchParams.set("type", type);
  else url.searchParams.delete("type");
  window.history.replaceState(window.history.state, "", url);
}

export interface TypeStats {
  total: number;
  published: number;
}

/**
 * Type cards + filter tabs + grid/list library. The whole (personal-sized)
 * library is loaded once; filtering and layout switching happen instantly in
 * the browser.
 */
export function Library({
  items,
  total,
  perType,
  initialType,
  initialView,
}: {
  items: LibraryItem[];
  total: number;
  perType: Record<ContentType, TypeStats>;
  initialType?: ContentType;
  initialView: LibraryView;
}) {
  const [active, setActive] = useState<ContentType | undefined>(initialType);
  const [view, setView] = useState<LibraryView>(initialView);
  const visible = useMemo(() => (active ? items.filter((i) => i.type === active) : items), [items, active]);

  const select = (type?: ContentType) => {
    setActive(type);
    syncUrl(type);
  };
  const changeView = (next: LibraryView) => {
    setView(next);
    persistView(next);
  };

  const tabs: { key?: ContentType; label: string; count: number }[] = [
    { label: "All", count: total },
    ...TYPE_ORDER.map((t) => ({ key: t, label: TYPE_META[t].plural, count: perType[t].total })),
  ];
  const activeMeta = active ? TYPE_META[active] : undefined;

  return (
    <>
      {/* One card per content type — each doubles as a filter for the library below. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Content by type">
        {TYPE_ORDER.map((type) => {
          const meta = TYPE_META[type];
          const selected = active === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => select(selected ? undefined : type)}
              aria-pressed={selected}
              className={cn(
                "group rounded-xl border bg-surface p-4 text-left shadow-card transition-colors hover:border-primary/40",
                selected && "border-primary ring-1 ring-primary",
              )}
            >
              <span className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground group-hover:text-foreground">{meta.plural}</span>
                <span className={cn("flex size-8 items-center justify-center rounded-lg", meta.tile)}>
                  <meta.icon className="size-4" />
                </span>
              </span>
              <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">{perType[type].total}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{perType[type].published} published</span>
            </button>
          );
        })}
      </section>

      <section id="library" className="scroll-mt-6 space-y-4" aria-label="Content library">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:pb-0" aria-label="Filter by type">
            {tabs.map((tab) => {
              const selected = tab.key === active;
              return (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => select(tab.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                    selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {tab.label}
                  <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", selected ? "bg-background/20" : "bg-muted")}>{tab.count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/content" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Manage <ArrowRight />
            </Link>
            <ViewToggle view={view} onChange={changeView} />
          </div>
        </div>

        {visible.length === 0 ? (
          <Card>
            <EmptyState
              icon={activeMeta ? <activeMeta.icon /> : <PlusCircle />}
              title={activeMeta ? `No ${activeMeta.plural.toLowerCase()} yet` : "No content yet"}
              description={
                activeMeta
                  ? `Add a ${activeMeta.label.toLowerCase()} URL and choose "${activeMeta.label}" as its type.`
                  : "Add the URL of something you wrote. You'll verify you own it, then publish it to your portfolio."
              }
              action={
                <Link href="/dashboard/add" className={buttonVariants({ size: "sm" })}>
                  <PlusCircle /> Add {activeMeta ? `a ${activeMeta.label.toLowerCase()}` : "content"}
                </Link>
              }
            />
          </Card>
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((item) => (
              <GridCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <ListRows items={visible} />
        )}

        {total > items.length && (
          <p className="text-center text-[13px] text-muted-foreground">
            Showing the {items.length} most recently updated of {total}.{" "}
            <Link href={`/dashboard/content${active ? `?type=${active}` : ""}`} className="font-medium text-primary hover:underline">
              See all
            </Link>
          </p>
        )}
      </section>
    </>
  );
}
