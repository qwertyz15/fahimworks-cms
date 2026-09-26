"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { updateContentAction } from "@/server/actions/content";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FormAlert } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Switch } from "@/components/ui/switch";
import { useFormAction } from "@/components/use-form-action";
import { TYPE_LABELS } from "./badges";

export interface EditableContent {
  id: string;
  url: string;
  title: string;
  type: string;
  description: string | null;
  summary: string | null;
  thumbnail: string | null;
  author: string | null;
  publishDate: string | null;
  tags: string[];
  featured: boolean;
  verified: boolean;
}

export function ContentEditForm({ content }: { content: EditableContent }) {
  const { state, onSubmit, pending, errors } = useFormAction(updateContentAction);

  return (
    <form onSubmit={onSubmit} noValidate>
      <input type="hidden" name="id" value={content.id} />
      <Card>
        <CardContent className="space-y-5 py-5">
          {!state.ok && <FormAlert message={state.error} />}
          <Field id="url" label="URL" error={errors?.url}>
            <Input id="url" name="url" type="url" defaultValue={content.url} required aria-invalid={Boolean(errors?.url)} />
          </Field>
          {content.verified && (
            <p className="-mt-3 flex items-center gap-1.5 text-xs text-warning">
              <AlertTriangle className="size-3.5" /> Changing the URL resets the item to Draft — ownership must be verified again.
            </p>
          )}
          <div className="grid gap-5 sm:grid-cols-[1fr_11rem]">
            <Field id="title" label="Title" error={errors?.title}>
              <Input id="title" name="title" defaultValue={content.title} required maxLength={300} aria-invalid={Boolean(errors?.title)} />
            </Field>
            <Field id="type" label="Type" error={errors?.type}>
              <Select id="type" name="type" defaultValue={content.type}>
                {Object.entries(TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="description" label="Description" error={errors?.description}>
            <Textarea id="description" name="description" defaultValue={content.description ?? ""} maxLength={2000} rows={3} />
          </Field>
          <Field id="summary" label="Summary" error={errors?.summary} hint="Shown on your portfolio. Generated automatically during extraction.">
            <Textarea id="summary" name="summary" defaultValue={content.summary ?? ""} maxLength={5000} rows={4} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="author" label="Author" error={errors?.author}>
              <Input id="author" name="author" defaultValue={content.author ?? ""} maxLength={200} />
            </Field>
            <Field id="publishDate" label="Publish date" error={errors?.publishDate}>
              <Input id="publishDate" name="publishDate" type="date" defaultValue={content.publishDate ?? ""} />
            </Field>
          </div>
          <Field id="thumbnail" label="Thumbnail URL" error={errors?.thumbnail}>
            <Input id="thumbnail" name="thumbnail" type="url" defaultValue={content.thumbnail ?? ""} placeholder="https://…" aria-invalid={Boolean(errors?.thumbnail)} />
          </Field>
          <Field id="tags" label="Tags" hint="Comma separated, up to 20.">
            <Input id="tags" name="tags" defaultValue={content.tags.join(", ")} />
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-lg border p-3.5">
            <span>
              <span className="block text-sm font-medium">Featured</span>
              <span className="block text-[13px] text-muted-foreground">Highlight this item on your portfolio (available via <code className="font-mono text-xs">?featured=true</code>).</span>
            </span>
            <Switch name="featured" defaultChecked={content.featured} />
          </label>
        </CardContent>
        <CardFooter>
          <Link href={`/dashboard/content/${content.id}`} className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
          <SubmitButton pending={pending} pendingText="Saving…">Save changes</SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}
