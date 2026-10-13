import type { Metadata } from "next";
import { FormAlert } from "@/components/ui/field";
import { NotebookBrowser } from "@/components/notebook/notebook-browser";
import { folderPageUrl, writtenPostUrl } from "@/lib/timeline";
import { listNotebook } from "@/server/queries/content";
import { listFolders } from "@/server/services/folders";

export const metadata: Metadata = { title: "Notebook" };

/** The Notebook: a folder tree with its entries (folders nest; entries live in one folder or at the top). */
export default async function NotebookPage({ searchParams }: PageProps<"/dashboard/notebook">) {
  const sp = await searchParams;
  const entries = await listNotebook(); // checks the session
  const folders = await listFolders();
  const folderId = typeof sp.folder === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(sp.folder) ? sp.folder : null;
  return (
    <div className="space-y-4">
      {sp.deleted && <FormAlert tone="success" message="Entry deleted." />}
      <NotebookBrowser
        folders={folders}
        entries={entries.map((e) => ({
          id: e.id,
          title: e.title,
          subtitle: e.subtitle,
          summary: e.summary,
          status: e.status,
          slug: e.slug,
          wordCount: e.wordCount,
          updatedAt: e.updatedAt.toISOString(),
          folderId: e.folderId,
          folderPosition: e.folderPosition,
        }))}
        initialFolderId={folderId}
        articleBase={writtenPostUrl("")}
        folderPageBase={folderPageUrl("")}
      />
    </div>
  );
}
