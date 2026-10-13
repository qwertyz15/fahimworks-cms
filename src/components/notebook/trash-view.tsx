"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Folder, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { emptyTrashAction, purgeTrashAction, restoreTrashAction } from "@/server/actions/history";
import type { TrashRow } from "@/server/services/trash";
import { ConfirmDialog } from "./dialogs";

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

export function TrashView({ items, days }: { items: TrashRow[]; days: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "one"; item: TrashRow } | { kind: "all" }>(null);

  const restore = async (t: TrashRow) => {
    setBusy(t.id);
    const r = await restoreTrashAction({ id: t.id });
    setBusy(null);
    if (!r.ok) return void toast.error(r.error);
    const href = r.data?.entryId ? `/dashboard/notebook/${r.data.entryId}` : r.data?.folderId ? `/dashboard/notebook?folder=${r.data.folderId}` : "/dashboard/notebook";
    toast.success(r.message ?? "Restored.", { action: { label: "Open", onClick: () => router.push(href) } });
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/dashboard/notebook" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Notebook
      </Link>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Trash2 className="size-5 text-muted-foreground" /> Trash
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Deleted entries and folders stay here for {days} days, then they&rsquo;re deleted for good. Restored entries come back as drafts.</p>
        </div>
        {items.length > 0 && (
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirm({ kind: "all" })}>
            <Trash2 /> Empty trash
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-surface">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Trash2 className="size-8 text-muted-foreground/40" />
            <p className="font-medium">The trash is empty</p>
            <p className="text-[13px] text-muted-foreground">Deleted entries and folders show up here.</p>
          </div>
        ) : (
          <ul className="divide-y" data-testid="trash-items">
            {items.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-4 py-3" data-trash-id={t.id}>
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{t.kind === "folder" ? <Folder className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.title || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.kind === "folder" ? `Folder · ${t.entryCount} ${t.entryCount === 1 ? "entry" : "entries"}${t.folderCount > 1 ? ` · ${t.folderCount - 1} subfolder${t.folderCount === 2 ? "" : "s"}` : ""} · ` : ""}
                    {t.from ? `from ${t.from} · ` : ""}deleted {dateFmt.format(new Date(t.deletedAt))} · gone in {daysLeft(t.purgeAt)} days
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" loading={busy === t.id} onClick={() => void restore(t)}>
                    <RotateCcw /> Restore
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Delete ${t.title} for good`} onClick={() => setConfirm({ kind: "one", item: t })}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "all" ? "Empty the trash?" : `Delete “${confirm.item.title}” for good?`}
          description={confirm.kind === "all" ? `All ${items.length} ${items.length === 1 ? "item" : "items"} and their version history will be deleted permanently.` : "It and its version history will be deleted permanently. This can't be undone."}
          confirm="Delete for good"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const r = confirm.kind === "all" ? await emptyTrashAction() : await purgeTrashAction({ ids: [confirm.item.id] });
            if (!r.ok) toast.error(r.error);
            else if (r.message) toast.success(r.message);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
