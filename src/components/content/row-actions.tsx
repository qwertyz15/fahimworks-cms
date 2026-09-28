"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Eye, MoreHorizontal, Pencil, Trash2, XCircle } from "lucide-react";
import type { ContentStatus } from "@/generated/prisma/enums";
import { approveAction, deleteContentAction } from "@/server/actions/content";
import { Dropdown, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { useRunAction } from "@/components/use-action-toast";
import { DeleteDialog, RejectDialog } from "./decision-dialogs";

export function RowActions({ id, title, status }: { id: string; title: string; status: ContentStatus }) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [dialog, setDialog] = useState<"reject" | "delete" | null>(null);
  const canDecide = status === "AWAITING_APPROVAL";

  return (
    <>
      <Dropdown label={`Actions for ${title}`} trigger={<MoreHorizontal className="m-1.5 size-4" />}>
        {(close) => (
          <>
            <MenuItem onSelect={() => { close(); router.push(`/dashboard/content/${id}`); }}>
              <Eye /> Preview
            </MenuItem>
            <MenuItem disabled={!canDecide || pending} onSelect={() => { close(); run(() => approveAction(id)); }}>
              <CheckCircle2 /> Approve
            </MenuItem>
            <MenuItem disabled={!canDecide && status !== "VERIFIED"} onSelect={() => { close(); setDialog("reject"); }}>
              <XCircle /> Reject
            </MenuItem>
            <MenuItem onSelect={() => { close(); router.push(`/dashboard/content/${id}/edit`); }}>
              <Pencil /> Edit
            </MenuItem>
            <MenuSeparator />
            <MenuItem destructive onSelect={() => { close(); setDialog("delete"); }}>
              <Trash2 /> Delete
            </MenuItem>
          </>
        )}
      </Dropdown>
      <RejectDialog id={id} open={dialog === "reject"} onClose={() => setDialog(null)} />
      <DeleteDialog
        title={title}
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => run(() => deleteContentAction(id), { onSuccess: () => setDialog(null) })}
        pending={pending}
      />
    </>
  );
}
