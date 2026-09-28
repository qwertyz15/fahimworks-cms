import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, PlusCircle } from "lucide-react";
import { StatusBadge, TypeBadge } from "@/components/content/badges";
import { ContentFilters } from "@/components/content/content-filters";
import { RowActions } from "@/components/content/row-actions";
import { Thumb } from "@/components/content/thumb";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, displayHost, formatDate } from "@/lib/utils";
import { listContent } from "@/server/queries/content";

export const metadata: Metadata = { title: "Content" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ContentPage({ searchParams }: PageProps<"/dashboard/content">) {
  const sp = await searchParams;
  const params = { q: str(sp.q), type: str(sp.type), status: str(sp.status), sort: str(sp.sort), page: Number(str(sp.page) ?? "1") || 1 };
  const { items, total, page, pageCount } = await listContent(params);
  const filtered = Boolean(params.q || params.type || params.status);

  const pageHref = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") next.set(k, String(v));
    if (p > 1) next.set("page", String(p));
    return `/dashboard/content${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content"
        description={`${total} item${total === 1 ? "" : "s"}${filtered ? " matching filters" : ""}`}
        actions={
          <Link href="/dashboard/add" className={buttonVariants()}>
            <PlusCircle /> Add content
          </Link>
        }
      />
      <Suspense>
        <ContentFilters />
      </Suspense>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={filtered ? "No matching content" : "No content yet"}
            description={filtered ? "Try a different search or clear the filters." : "Add a URL to get started."}
            action={
              filtered ? (
                <Link href="/dashboard/content" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
          {/* Phones: compact list */}
          <ul className="divide-y md:hidden">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <Thumb src={item.thumbnail} className="mt-0.5 size-9 shrink-0" />
                <Link href={`/dashboard/content/${item.id}`} className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{displayHost(item.url)} · {formatDate(item.publishedAt ?? item.createdAt)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <TypeBadge type={item.type} />
                    <StatusBadge status={item.status} />
                  </div>
                </Link>
                <RowActions id={item.id} title={item.title} status={item.status} />
              </li>
            ))}
          </ul>
          {/* `relative` keeps absolutely-positioned descendants (sr-only labels) inside the scroll clip */}
          <div className="relative hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b bg-surface-2/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Title</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">URL</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="group hover:bg-surface-2/50">
                    <td className="max-w-80 px-4 py-2.5">
                      <Link href={`/dashboard/content/${item.id}`} className="flex items-center gap-3">
                        <Thumb src={item.thumbnail} className="size-8 shrink-0" />
                        <span className="truncate font-medium group-hover:underline">{item.title}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5"><TypeBadge type={item.type} /></td>
                    <td className="max-w-48 px-3 py-2.5">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
                        <span className="truncate">{displayHost(item.url)}{new URL(item.url).pathname !== "/" ? new URL(item.url).pathname : ""}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge status={item.status} /></td>
                    <td className="px-3 py-2.5 text-[13px] whitespace-nowrap text-muted-foreground">{formatDate(item.publishedAt ?? item.createdAt)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end"><RowActions id={item.id} title={item.title} status={item.status} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {pageCount > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <Link aria-disabled={page <= 1} href={pageHref(page - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}>
              <ChevronLeft /> Previous
            </Link>
            <Link aria-disabled={page >= pageCount} href={pageHref(page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pageCount && "pointer-events-none opacity-50")}>
              Next <ChevronRight />
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
