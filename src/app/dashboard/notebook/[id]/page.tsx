import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { EntryEditor } from "@/components/editor/entry-editor";
import { writtenPostUrl } from "@/lib/timeline";
import { mediaUploadLimitBytes, uploadLimitBytes, uploadsEnabled } from "@/lib/storage";
import { getNotebookEntry } from "@/server/queries/content";
import { deriveFields } from "@/server/services/notebook-html";
import { sourcePageOf } from "@/server/databases/publish";
import Link from "next/link";
import { ArrowUpRight, Database } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Edit entry" };

export default async function EditEntryPage({ params }: PageProps<"/dashboard/notebook/[id]">) {
  const { id } = await params;
  const entry = await getNotebookEntry(id);
  if (!entry) notFound();

  // Published from a database page: that page is the source, so it's edited there.
  const source = await sourcePageOf(entry.id);
  if (source) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-4 shadow-card" role="status">
          <Database className="size-5 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Published from a database page — edit it there</p>
            <p className="text-xs text-muted-foreground">
              {source.database ? `${source.database.icon ?? ""} ${source.database.title} · ` : ""}
              {source.title || "Untitled"}. Changes go live with “Update live” on the page.
            </p>
          </div>
          <Link href={`/dashboard/pages/${source.id}`} className={buttonVariants({ size: "sm" })}>
            Open the page
          </Link>
          {entry.status === "PUBLISHED" && (
            <a href={writtenPostUrl(entry.slug)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
              View live <ArrowUpRight />
            </a>
          )}
        </div>
        <article className="prose-content prose-article rounded-xl border bg-surface p-6" aria-label="Article preview">
          <h1>{entry.title}</h1>
          {/* contentHtml is sanitised on every save (services/notebook-html.ts). */}
          <div dangerouslySetInnerHTML={{ __html: entry.contentHtml ?? "" }} />
        </article>
      </div>
    );
  }
  // A summary equal to the auto-generated one wasn't written by you: show the field
  // empty so it keeps following the first paragraph instead of freezing.
  const auto = entry.contentHtml ? deriveFields(entry.contentHtml).autoSummary : null;
  const summary = entry.summary && entry.summary !== auto ? entry.summary : null;

  return (
    <EntryEditor
      key={entry.id}
      articleBaseUrl={writtenPostUrl("")}
      uploads={{ enabled: uploadsEnabled(), maxBytes: uploadLimitBytes(), maxMediaBytes: mediaUploadLimitBytes() }}
      entry={{
        id: entry.id,
        title: entry.title,
        subtitle: entry.subtitle,
        status: entry.status,
        slug: entry.slug,
        summary,
        featured: entry.featured,
        coverImage: entry.coverImage,
        body: (entry.body as JSONContent | null) ?? null,
        tags: entry.tags.map((t) => t.name),
        updatedAt: entry.updatedAt.toISOString(),
        wordCount: entry.wordCount ?? 0,
        readingMinutes: entry.readingMinutes ?? 0,
      }}
    />
  );
}
