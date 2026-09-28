/* eslint-disable @next/next/no-img-element -- arbitrary remote hosts */
import { AlertCircle, Camera, ExternalLink, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState, MetaRow } from "@/components/ui/misc";
import { displayHost, formatDate, formatDateTime } from "@/lib/utils";
import type { ContentDetail } from "@/server/queries/content";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function PreviewPanel({ content, screenshot }: { content: ContentDetail; screenshot: string | null }) {
  const images = asStringArray(content.images);
  const metadata = asRecord(content.metadata);
  const extracted = content.extractionStatus === "SUCCEEDED";

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader
          title="Preview"
          description={extracted ? `Extracted ${formatDateTime(content.extractedAt)}` : "Not extracted yet — click Extract content."}
          action={
            <a href={content.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
              Open original <ExternalLink className="size-3.5" />
            </a>
          }
        />
        {content.extractionStatus === "FAILED" && content.extractionError && (
          <div className="mx-5 mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-[13px] text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {content.extractionError}
          </div>
        )}
        <CardContent className="grid gap-5 md:grid-cols-2">
          <figure className="space-y-1.5">
            <div className="aspect-[16/10] overflow-hidden rounded-lg border bg-muted">
              {screenshot ? (
                <img src={screenshot} alt={`Screenshot of ${content.url}`} className="size-full object-cover object-top" loading="lazy" referrerPolicy="no-referrer" />
              ) : content.thumbnail ? (
                <img src={content.thumbnail} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Camera className="size-5" /> No screenshot available
                </div>
              )}
            </div>
            <figcaption className="text-xs text-muted-foreground">
              {screenshot ? "Live screenshot" : content.thumbnail ? "Open Graph image (set SCREENSHOT_URL_TEMPLATE for live screenshots)" : "Configure SCREENSHOT_URL_TEMPLATE to enable screenshots"}
            </figcaption>
          </figure>

          {/* Social-card style preview of how the item will appear in the portfolio */}
          <div className="flex flex-col overflow-hidden rounded-lg border">
            {content.thumbnail ? (
              <img src={content.thumbnail} alt="" className="aspect-[1.91/1] w-full border-b object-cover" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex aspect-[1.91/1] items-center justify-center border-b bg-muted text-muted-foreground">
                <ImageIcon className="size-5" />
              </div>
            )}
            <div className="space-y-1 p-3.5">
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{content.siteName ?? displayHost(content.url)}</p>
              <p className="leading-snug font-semibold">{content.title}</p>
              {content.description && <p className="line-clamp-3 text-[13px] text-muted-foreground">{content.description}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Extracted metadata" />
        <CardContent className="py-2">
          <dl className="divide-y">
            <MetaRow label="Title">{content.title}</MetaRow>
            <MetaRow label="Description">{content.description}</MetaRow>
            <MetaRow label="Author">{content.author}</MetaRow>
            <MetaRow label="Publish date">{content.publishDate ? formatDate(content.publishDate) : null}</MetaRow>
            <MetaRow label="Site">{content.siteName}</MetaRow>
            <MetaRow label="Language">{content.language}</MetaRow>
            <MetaRow label="Canonical URL">{content.canonicalUrl && <a href={content.canonicalUrl} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{content.canonicalUrl}</a>}</MetaRow>
            {content.finalUrl && content.finalUrl !== content.url && <MetaRow label="Final URL">{content.finalUrl}</MetaRow>}
            <MetaRow label="Length">{content.wordCount ? `${content.wordCount.toLocaleString()} words · ${content.readingMinutes} min read` : null}</MetaRow>
            <MetaRow label="Tags">
              {content.tags.length ? (
                <div className="flex flex-wrap gap-1">
                  {content.tags.map((t) => <Badge key={t.id}>{t.name}</Badge>)}
                </div>
              ) : null}
            </MetaRow>
            {typeof metadata.ogType === "string" && <MetaRow label="og:type">{metadata.ogType}</MetaRow>}
            {Array.isArray(metadata.jsonLdTypes) && metadata.jsonLdTypes.length > 0 && <MetaRow label="Schema.org">{(metadata.jsonLdTypes as string[]).join(", ")}</MetaRow>}
            {typeof metadata.section === "string" && <MetaRow label="Section">{metadata.section}</MetaRow>}
            {typeof metadata.modifiedTime === "string" && <MetaRow label="Last modified">{formatDate(metadata.modifiedTime)}</MetaRow>}
            {typeof metadata.generator === "string" && <MetaRow label="Generator">{metadata.generator}</MetaRow>}
          </dl>
        </CardContent>
      </Card>

      {content.summary && (
        <Card>
          <CardHeader title="Content summary" />
          <CardContent>
            <p className="text-sm leading-relaxed">{content.summary}</p>
          </CardContent>
        </Card>
      )}

      {images.length > 0 && (
        <Card>
          <CardHeader title="Images" description={`${images.length} found on the page`} />
          <CardContent className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-md border bg-muted">
                <img src={src} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader title="Main content" description="Sanitised copy of the article body, for review only." />
        {content.contentHtml ? (
          <details className="group">
            <summary className="cursor-pointer px-5 py-3 text-[13px] font-medium text-primary select-none hover:underline">
              <span className="group-open:hidden">Show extracted content</span>
              <span className="hidden group-open:inline">Hide extracted content</span>
            </summary>
            {/* contentHtml is sanitised with an allowlist at extraction time (see extraction/parse.ts); CSP blocks inline scripts as a second layer. */}
            <div className="prose-content max-h-[36rem] overflow-y-auto border-t px-5 py-4" dangerouslySetInnerHTML={{ __html: content.contentHtml }} />
          </details>
        ) : (
          <EmptyState title="Not extracted yet" />
        )}
      </Card>
    </div>
  );
}
