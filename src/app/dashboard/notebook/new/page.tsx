import type { Metadata } from "next";
import { EntryEditor } from "@/components/editor/entry-editor";
import { writtenPostUrl } from "@/lib/timeline";
import { mediaUploadLimitBytes, uploadLimitBytes, uploadsEnabled } from "@/lib/storage";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "New entry" };

/** Blank editor. The entry is created on its first save. */
export default async function NewEntryPage() {
  await requireAdmin();
  return <EntryEditor entry={null} articleBaseUrl={writtenPostUrl("")} uploads={{ enabled: uploadsEnabled(), maxBytes: uploadLimitBytes(), maxMediaBytes: mediaUploadLimitBytes() }} />;
}
