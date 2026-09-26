import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { DuplicateWarning } from "@/server/services/duplicates-core";

const KIND_LABEL = { URL: "Same URL", TITLE: "Similar title", CONTENT: "Similar content" } as const;

export function DuplicateWarnings({ warnings, compact }: { warnings: DuplicateWarning[]; compact?: boolean }) {
  if (!warnings.length) return null;
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/8 p-3.5" role="alert">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 text-warning" />
        {warnings.length === 1 ? "Possible duplicate found" : `${warnings.length} possible duplicates found`}
      </div>
      {!compact && <p className="mt-1 text-[13px] text-muted-foreground">Similar content already exists in your library. Make sure this isn&apos;t a repost before continuing.</p>}
      <ul className="mt-2.5 space-y-1.5">
        {warnings.map((w, i) => (
          <li key={`${w.contentId}-${w.kind}-${i}`} className="flex flex-wrap items-center gap-x-2 text-[13px]">
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium">{KIND_LABEL[w.kind]}</span>
            <Link href={`/dashboard/content/${w.contentId}`} className="font-medium hover:underline" target="_blank">
              {w.title}
            </Link>
            <span className="text-muted-foreground">— {w.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
