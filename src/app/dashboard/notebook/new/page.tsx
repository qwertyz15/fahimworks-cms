import type { Metadata } from "next";
import { EntryEditor } from "@/components/editor/entry-editor";
import { writtenPostUrl } from "@/lib/timeline";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "New entry" };

/** Blank editor. The entry is created on its first save. */
export default async function NewEntryPage() {
  await requireAdmin();
  return <EntryEditor entry={null} articleBaseUrl={writtenPostUrl("")} />;
}
