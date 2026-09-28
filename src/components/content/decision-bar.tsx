"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeOff, Pencil, RefreshCw, RotateCcw, Send, Trash2, XCircle } from "lucide-react";
import type { ContentStatus, ExtractionStatus } from "@/generated/prisma/enums";
import { deleteContentAction, publishAction, reextractAction, reopenAction, unpublishAction } from "@/server/actions/content";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRunAction } from "@/components/use-action-toast";
import { DeleteDialog, RejectDialog } from "./decision-dialogs";

export function DecisionBar({
  id,
  title,
  status,
  extractionStatus,
  hasDuplicates,
}: {
  id: string;
  title: string;
  status: ContentStatus;
  extractionStatus: ExtractionStatus;
  hasDuplicates: boolean;
}) {
  const main = useRunAction();
  const extract = useRunAction();
  const del = useRunAction();
  const [dialog, setDialog] = useState<"reject" | "delete" | null>(null);
  const canExtract = status !== "REJECTED";
  const needsExtraction = extractionStatus !== "SUCCEEDED";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Publish from any unpublished stage once the page has been extracted. */}
      {status !== "PUBLISHED" && !needsExtraction && (
        <Button variant="success" loading={main.pending} onClick={() => main.run(() => publishAction(id))} title={hasDuplicates ? "Possible duplicates exist — review them first" : undefined}>
          <Send /> Publish
        </Button>
      )}
      {(status === "AWAITING_APPROVAL" || status === "VERIFIED") && (
        <Button variant="outline" onClick={() => setDialog("reject")}>
          <XCircle /> Reject
        </Button>
      )}
      {status === "PUBLISHED" && (
        <Button variant="outline" loading={main.pending} onClick={() => main.run(() => unpublishAction(id))}>
          <EyeOff /> Unpublish
        </Button>
      )}
      {status === "REJECTED" && (
        <Button variant="outline" loading={main.pending} onClick={() => main.run(() => reopenAction(id))}>
          <RotateCcw /> Reopen
        </Button>
      )}
      {canExtract && (
        <Button variant={needsExtraction ? "primary" : "ghost"} loading={extract.pending} onClick={() => extract.run(() => reextractAction(id))}>
          <RefreshCw /> {extractionStatus === "SUCCEEDED" ? "Re-extract" : "Extract content"}
        </Button>
      )}
      <Link href={`/dashboard/content/${id}/edit`} className={buttonVariants({ variant: "ghost" })}>
        <Pencil /> Edit
      </Link>
      <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog("delete")}>
        <Trash2 /> Delete
      </Button>

      <RejectDialog id={id} open={dialog === "reject"} onClose={() => setDialog(null)} />
      <DeleteDialog
        title={title}
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        pending={del.pending}
        onConfirm={() => del.run(() => deleteContentAction(id, true))}
      />
    </div>
  );
}
