"use client";

import { useState } from "react";
import { CheckCircle2, Globe, Link2, Search, Send, XCircle } from "lucide-react";
import { createContentAction, previewUrlAction } from "@/server/actions/content";
import type { UrlPreview } from "@/server/services/content";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, FormAlert } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn, displayHost } from "@/lib/utils";
import { useFormAction } from "@/components/use-form-action";
import { TYPE_LABELS } from "./badges";
import { DuplicateWarnings } from "./duplicate-warnings";
import { Thumb } from "./thumb";

export function AddContentWizard() {
  const { state: preview, onSubmit: analyze, pending: analyzing } = useFormAction<UrlPreview>(previewUrlAction);
  const { state: created, onSubmit: create, pending: creating } = useFormAction(createContentAction);
  const [type, setType] = useState("BLOG");
  const [intent, setIntent] = useState<"publish" | "review">("publish");
  const data = preview.ok ? preview.data : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. Content URL" description="Paste the link to a post, tutorial, article or project page. It must be publicly reachable." />
        <form onSubmit={analyze}>
          <CardContent className="space-y-4">
            {!preview.ok && <FormAlert message={preview.error} />}
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <Field id="url" label="URL" error={!preview.ok ? preview.fieldErrors?.url : undefined}>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="url" name="url" type="url" required placeholder="https://yourblog.com/posts/my-article" className="pl-9" defaultValue={data?.url} key={data?.url} autoFocus />
                </div>
              </Field>
              <Field id="type" label="Type">
                <Select id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </CardContent>
          <CardFooter>
            <SubmitButton pending={analyzing} variant={data ? "outline" : "primary"} pendingText="Analyzing page…">
              <Search /> {data ? "Re-analyze" : "Analyze URL"}
            </SubmitButton>
          </CardFooter>
        </form>
      </Card>

      {data && (
        <Card>
          <CardHeader title="2. Review & publish" description="We checked the page and your library for duplicates. Publishing imports the content and puts it on your portfolio." />
          <form onSubmit={create}>
            <input type="hidden" name="url" value={data.url} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="title" value={data.title ?? ""} />
            <input type="hidden" name="method" value="META_TAG" />
            <input type="hidden" name="hasWarnings" value={String(data.warnings.length > 0)} />
            <CardContent className="space-y-5">
              {!created.ok && <FormAlert message={created.error} />}

              <div className="flex gap-4 rounded-lg border bg-surface-2/50 p-3.5">
                <Thumb src={data.thumbnail} className="hidden h-20 w-32 shrink-0 sm:block" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{data.title ?? "Untitled page"}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Globe className="size-3.5" />
                    {data.siteName ?? displayHost(data.finalUrl)}
                    {data.author && <> · {data.author}</>} · {data.wordCount.toLocaleString()} words
                  </p>
                  {data.description && <p className="line-clamp-2 text-[13px] text-muted-foreground">{data.description}</p>}
                  {data.finalUrl !== data.url && <p className="text-xs text-muted-foreground">Redirects to {data.finalUrl}</p>}
                </div>
              </div>

              <div
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]",
                  data.meaningful.ok ? "border-success/30 bg-success/8" : "border-destructive/30 bg-destructive/8 text-destructive",
                )}
              >
                {data.meaningful.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                {data.meaningful.ok ? "Looks like a real article — readable content was found." : `This page can't be added: ${data.meaningful.reason}`}
              </div>

              <DuplicateWarnings warnings={data.warnings} />
              {data.warnings.length > 0 && (
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="acknowledgeDuplicates" className="size-4 accent-[var(--color-primary)]" required />
                  I understand — add it anyway.
                </label>
              )}

              <Field id="tags" label="Tags" hint="Comma separated. Tags found on the page are merged in after extraction.">
                <Input id="tags" name="tags" defaultValue={data.suggestedTags.join(", ")} key={data.url} placeholder="nextjs, typescript" />
              </Field>
            </CardContent>
            <CardFooter>
              <SubmitButton
                name="intent"
                value="review"
                variant="outline"
                pending={creating && intent === "review"}
                disabled={!data.meaningful.ok || creating}
                onClick={() => setIntent("review")}
                pendingText="Saving…"
              >
                Save for review
              </SubmitButton>
              <SubmitButton
                name="intent"
                value="publish"
                pending={creating && intent === "publish"}
                disabled={!data.meaningful.ok || creating}
                onClick={() => setIntent("publish")}
                pendingText="Publishing…"
              >
                <Send /> Publish
              </SubmitButton>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
