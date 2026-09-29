/* eslint-disable @next/next/no-img-element -- cover images from the media bucket */
import type { ExportMeta } from "@/lib/export/document";
import { MermaidBlocks } from "@/components/timeline/mermaid-blocks";
import { PrintControls } from "./print-controls";

const longDate = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** An entry / page laid out for paper (Print → Save as PDF). */
export function PrintView({ meta, html }: { meta: ExportMeta; html: string }) {
  return (
    <div className="print-view min-h-dvh bg-background">
      <PrintControls selector="#print-body" />
      <div className="mx-auto w-full max-w-3xl px-6 py-10 print:max-w-none print:p-0">
        <header className="mb-8 space-y-3">
          <h1 className="text-4xl leading-[1.15] font-semibold tracking-tight text-balance">{meta.title || "Untitled"}</h1>
          {meta.subtitle && <p className="text-xl leading-relaxed text-muted-foreground">{meta.subtitle}</p>}
          {(meta.date || meta.tags?.length) && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {meta.date && <time dateTime={meta.date}>{longDate.format(new Date(`${meta.date}T00:00:00Z`))}</time>}
              {meta.tags?.map((t) => (
                <span key={t}>#{t}</span>
              ))}
            </p>
          )}
          {meta.properties && meta.properties.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 border-t pt-3 text-sm">
              {meta.properties.map((p) => (
                <div key={p.name} className="contents">
                  <dt className="text-muted-foreground">{p.name}</dt>
                  <dd>{p.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </header>
        {meta.coverImage && <img data-print-cover src={meta.coverImage} alt="" referrerPolicy="no-referrer" className="mb-8 w-full rounded-xl border object-cover" />}
        {/* contentHtml is sanitised with a strict allowlist on every save (services/notebook-html.ts). */}
        <article id="print-body" className="prose-content prose-article" dangerouslySetInnerHTML={{ __html: html }} />
        <MermaidBlocks selector="#print-body" />
      </div>
    </div>
  );
}
