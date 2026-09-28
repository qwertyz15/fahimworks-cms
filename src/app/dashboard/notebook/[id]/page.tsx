import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { EntryEditor } from "@/components/editor/entry-editor";
import { getNotebookEntry } from "@/server/queries/content";
import { deriveFields } from "@/server/services/notebook-html";

export const metadata: Metadata = { title: "Edit entry" };

export default async function EditEntryPage({ params }: PageProps<"/dashboard/notebook/[id]">) {
  const { id } = await params;
  const entry = await getNotebookEntry(id);
  if (!entry) notFound();
  // A summary equal to the auto-generated one wasn't written by you: show the field
  // empty so it keeps following the first paragraph instead of freezing.
  const auto = entry.contentHtml ? deriveFields(entry.contentHtml).autoSummary : null;
  const summary = entry.summary && entry.summary !== auto ? entry.summary : null;

  return (
    <EntryEditor
      key={entry.id}
      entry={{
        id: entry.id,
        title: entry.title,
        subtitle: entry.subtitle,
        type: entry.type,
        status: entry.status,
        slug: entry.slug,
        summary,
        featured: entry.featured,
        body: (entry.body as JSONContent | null) ?? null,
        tags: entry.tags.map((t) => t.name),
        updatedAt: entry.updatedAt.toISOString(),
        wordCount: entry.wordCount ?? 0,
        readingMinutes: entry.readingMinutes ?? 0,
      }}
    />
  );
}
