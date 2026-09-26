/* eslint-disable @next/next/no-img-element -- remote images from arbitrary hosts; next/image would become an open proxy */
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function Thumb({ src, alt = "", className }: { src?: string | null; alt?: string; className?: string }) {
  if (!src) {
    return (
      <div className={cn("flex items-center justify-center rounded-md border bg-muted text-muted-foreground", className)} aria-hidden>
        <FileText className="size-4" />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={cn("rounded-md border bg-muted object-cover", className)} />;
}
