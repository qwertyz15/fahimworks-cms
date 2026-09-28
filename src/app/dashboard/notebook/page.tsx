import type { Metadata } from "next";
import Link from "next/link";
import { NotebookPen, PenLine } from "lucide-react";
import { StatusBadge, TypeBadge } from "@/components/content/badges";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import { listNotebook } from "@/server/queries/content";

export const metadata: Metadata = { title: "Notebook" };

export default async function NotebookPage({ searchParams }: PageProps<"/dashboard/notebook">) {
  const sp = await searchParams;
  const entries = await listNotebook();
  const drafts = entries.filter((e) => e.status !== "PUBLISHED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notebook"
        description={entries.length ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} · ${drafts} draft${drafts === 1 ? "" : "s"}` : "Write posts here and publish them to your timeline."}
        actions={
          <Link href="/dashboard/notebook/new" className={buttonVariants()}>
            <PenLine /> New entry
          </Link>
        }
      />
      {sp.deleted && <FormAlert tone="success" message="Entry deleted." />}

      <Card className="overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState
            icon={<NotebookPen />}
            title="Your notebook is empty"
            description="Start a blog post, tutorial or article. Drafts save automatically while you write."
            action={
              <Link href="/dashboard/notebook/new" className={buttonVariants({ size: "sm" })}>
                <PenLine /> Write your first entry
              </Link>
            }
          />
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <li key={e.id}>
                <Link href={`/dashboard/notebook/${e.id}`} className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-surface-2/60">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium">{e.title}</p>
                    {(e.subtitle ?? e.summary) && <p className="line-clamp-1 text-[13px] text-muted-foreground">{e.subtitle ?? e.summary}</p>}
                    <p className="text-xs text-muted-foreground">
                      Edited {formatDate(e.updatedAt)} · {(e.wordCount ?? 0).toLocaleString()} words
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    <TypeBadge type={e.type} />
                    <StatusBadge status={e.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
