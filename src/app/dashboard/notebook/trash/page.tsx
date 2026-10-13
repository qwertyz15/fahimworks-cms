import type { Metadata } from "next";
import { TrashView } from "@/components/notebook/trash-view";
import { requireAdmin } from "@/server/auth/guards";
import { listTrash, purgeExpiredTrash, TRASH_DAYS } from "@/server/services/trash";

export const metadata: Metadata = { title: "Trash" };

/** Deleted Notebook entries and folders, restorable for 30 days. */
export default async function TrashPage() {
  await requireAdmin();
  // Anything past its 30 days goes now (the daily job does this too).
  await purgeExpiredTrash();
  return <TrashView items={await listTrash()} days={TRASH_DAYS} />;
}
