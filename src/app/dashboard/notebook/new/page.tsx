import type { Metadata } from "next";
import { EntryEditor } from "@/components/editor/entry-editor";
import { writtenPostUrl } from "@/lib/timeline";
import { mediaUploadLimitBytes, uploadLimitBytes, uploadsEnabled } from "@/lib/storage";
import { requireAdmin } from "@/server/auth/guards";
import { listFolders } from "@/server/services/folders";

export const metadata: Metadata = { title: "New entry" };

/** Blank editor. The entry is created on its first save. */
export default async function NewEntryPage({ searchParams }: PageProps<"/dashboard/notebook/new">) {
  await requireAdmin();
  const sp = await searchParams;
  const folders = await listFolders();
  // Started from a folder: it's created there.
  const folderId = typeof sp.folder === "string" && folders.some((f) => f.id === sp.folder) ? sp.folder : null;
  return <EntryEditor entry={null} folders={folders} folderId={folderId} articleBaseUrl={writtenPostUrl("")} uploads={{ enabled: uploadsEnabled(), maxBytes: uploadLimitBytes(), maxMediaBytes: mediaUploadLimitBytes() }} />;
}
