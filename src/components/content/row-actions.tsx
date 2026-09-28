"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, MoreHorizontal, Pencil, Send, Trash2, XCircle } from "lucide-react";
import type { ContentStatus, ExtractionStatus } from "@/generated/prisma/enums";
import { deleteContentAction, publishAction, unpublishAction } from "@/server/actions/content";
import { Dropdown, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { useRunAction } from "@/components/use-action-toast";
import { DeleteDialog, RejectDialog } from "./decision-dialogs";

export interface RowActionsProps {
  id: string;
  title: string;
  status: ContentStatus;
  source: "IMPORTED" | "WRITTEN";
  extractionStatus: ExtractionStatus;
}

export function RowActions({ id, title, status, source, extractionStatus }: RowActionsProps) {
  const router = useRouter();
  const { run, pending } = useRunAction();
  const [dialog, setDialog] = useState<"reject" | "delete" | null>(null);
  const written = source === "WRITTEN";
  const published = status === "PUBLISHED";
  // Imported items need a successful extraction before they can go live.
  const canPublish = written || extractionStatus === "SUCCEEDED";
  const canReject = !written && (status === "AWAITING_APPROVAL" || status === "VERIFIED");
  const openHref = written ? `/dashboard/notebook/${id}` : `/dashboard/content/${id}`;
  const editHref = written ? `/dashboard/notebook/${id}` : `/dashboard/content/${id}/edit`;

  return (
    <>
      <Dropdown label={`Actions for ${title}`} trigger={<MoreHorizontal className="m-1.5 size-4" />}>
        {(close) => (
          <>
            <MenuItem onSelect={() => { close(); router.push(openHref); }}>
              <Eye /> {written ? "Open in Notebook" : "Preview"}
            </MenuItem>
            {published ? (
              <MenuItem disabled={pending} onSelect={() => { close(); run(() => unpublishAction(id)); }}>
                <EyeOff /> Unpublish
              </MenuItem>
            ) : (
              <MenuItem disabled={pending || !canPublish} onSelect={() => { close(); run(() => publishAction(id)); }}>
                <Send /> {canPublish ? "Publish" : "Publish (extract first)"}
              </MenuItem>
            )}
            {!written && (
              <MenuItem disabled={!canReject} onSelect={() => { close(); setDialog("reject"); }}>
                <XCircle /> Reject
              </MenuItem>
            )}
            <MenuItem onSelect={() => { close(); router.push(editHref); }}>
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
