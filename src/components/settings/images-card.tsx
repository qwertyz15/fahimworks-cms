"use client";

import { ImageIcon, Trash2 } from "lucide-react";
import { cleanupImagesAction } from "@/server/actions/notebook";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { useRunAction } from "@/components/use-action-toast";

export function ImagesCard({ enabled, count, bytes, publicUrl }: { enabled: boolean; count: number; bytes: number; publicUrl: string | null }) {
  const { run, pending } = useRunAction();
  return (
    <Card>
      <CardHeader title="Uploads" description="Images, videos and files uploaded from the Notebook editor, stored in your bucket." />
      <CardContent className="flex items-center gap-3 text-sm">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ImageIcon className="size-4" />
        </span>
        {enabled ? (
          <span>
            <span className="font-medium">{count.toLocaleString()} file{count === 1 ? "" : "s"}</span>{" "}
            <span className="text-muted-foreground">· {(bytes / (1024 * 1024)).toFixed(1)} MB{publicUrl ? ` · served from ${publicUrl.replace(/^https?:\/\//, "")}` : ""}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Uploads are off — set the S3_* environment variables to enable them.</span>
        )}
      </CardContent>
      {enabled && (
        <CardFooter className="justify-between">
          <span className="text-xs text-muted-foreground">Deletes uploads that no entry uses any more (older than 1 hour).</span>
          <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => cleanupImagesAction())}>
            <Trash2 /> Remove unused uploads
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
