"use client";

import { useState } from "react";
import { rejectAction } from "@/server/actions/content";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { useRunAction } from "@/components/use-action-toast";

export function RejectDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { run, pending } = useRunAction();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reject this item?"
      description="It will not be published. You can reopen it later."
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" loading={pending} onClick={() => run(() => rejectAction(id, reason), { onSuccess: onClose })}>
            Reject
          </Button>
        </>
      }
    >
      <Field id={`reason-${id}`} label="Reason (optional)" hint="Stored for your own reference.">
        <Textarea id={`reason-${id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Outdated, superseded by a newer post" />
      </Field>
    </Dialog>
  );
}

export function DeleteDialog({ title, open, onClose, onConfirm, pending }: { title: string; open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete content?"
      description={<>“{title}” and its verification history will be permanently deleted. If it is published, it disappears from your portfolio.</>}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" loading={pending} onClick={onConfirm}>
            Delete permanently
          </Button>
        </>
      }
    />
  );
}
