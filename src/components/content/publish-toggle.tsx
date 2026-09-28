"use client";

import { EyeOff, Send } from "lucide-react";
import type { ContentStatus, ExtractionStatus } from "@/generated/prisma/enums";
import { publishAction, unpublishAction } from "@/server/actions/content";
import { useRunAction } from "@/components/use-action-toast";
import { cn } from "@/lib/utils";

/** Compact Publish / Unpublish button for lists. Sits above stretched card links (z-10). */
export function PublishToggle({
  id,
  status,
  source,
  extractionStatus,
  className,
}: {
  id: string;
  status: ContentStatus;
  source: "IMPORTED" | "WRITTEN";
  extractionStatus: ExtractionStatus;
  className?: string;
}) {
  const { run, pending } = useRunAction();
  const published = status === "PUBLISHED";
  const canPublish = source === "WRITTEN" || extractionStatus === "SUCCEEDED";

  return (
    <button
      type="button"
      disabled={pending || (!published && !canPublish)}
      title={published ? "Remove from your timeline (becomes a draft)" : canPublish ? "Publish to your timeline" : "Extract the page before publishing"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        run(() => (published ? unpublishAction(id) : publishAction(id)));
      }}
      className={cn(
        "relative z-10 inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5",
        published
          ? "bg-surface text-muted-foreground hover:bg-muted hover:text-foreground"
          : "border-success/40 bg-success/10 text-success hover:bg-success/20",
        className,
      )}
    >
      {pending ? "…" : published ? <><EyeOff /> Unpublish</> : <><Send /> Publish</>}
    </button>
  );
}
