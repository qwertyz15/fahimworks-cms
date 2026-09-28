import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ContentEditForm } from "@/components/content/content-edit-form";
import { PageHeader } from "@/components/ui/misc";
import { getContentDetail } from "@/server/queries/content";

export const metadata: Metadata = { title: "Edit content" };

export default async function EditContentPage({ params }: PageProps<"/dashboard/content/[id]/edit">) {
  const { id } = await params;
  const content = await getContentDetail(id);
  if (!content) notFound();
  // Notebook entries are edited in the Notebook editor, not here.
  if (content.source === "WRITTEN" || !content.url) redirect(`/dashboard/notebook/${content.id}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={`/dashboard/content/${id}`} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to item
      </Link>
      <PageHeader title="Edit content" description="Adjust the details shown on your portfolio." />
      <ContentEditForm
        content={{
          id: content.id,
          url: content.url,
          title: content.title,
          type: content.type,
          description: content.description,
          summary: content.summary,
          thumbnail: content.thumbnail,
          author: content.author,
          publishDate: content.publishDate ? content.publishDate.toISOString().slice(0, 10) : null,
          tags: content.tags.map((t) => t.name),
          featured: content.featured,
        }}
      />
    </div>
  );
}
