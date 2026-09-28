"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { ArrowUpRight } from "lucide-react";
import { updateSettingsAction } from "@/server/actions/settings";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, FormAlert } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Switch } from "@/components/ui/switch";
import { useFormAction } from "@/components/use-form-action";

export interface SettingsValues {
  siteName: string;
  portfolioUrl: string | null;
  minWordCount: number;
  allowRegistration: boolean;
  publicApiEnabled: boolean;
  allowedOrigins: string[];
  timelineEnabled: boolean;
  timelineIndexable: boolean;
  profileName: string | null;
  profileTagline: string | null;
  profileGithub: string | null;
  profileLinkedin: string | null;
  profileX: string | null;
  profileWebsite: string | null;
  profileEmail: string | null;
}

function ToggleRow({ name, title, description, defaultChecked, warn }: { name: string; title: string; description: string; defaultChecked: boolean; warn?: string }) {
  return (
    <label className="flex items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{description}</span>
        {warn && <span className="mt-1 block text-xs text-warning">{warn}</span>}
      </span>
      <Switch name={name} defaultChecked={defaultChecked} className="mt-0.5" />
    </label>
  );
}

export function SettingsForm({ values, timelineUrl }: { values: SettingsValues; timelineUrl: string }) {
  const { state, onSubmit, pending, errors } = useFormAction(updateSettingsAction);
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {!state.ok && <FormAlert message={state.error} />}
      <Card>
        <CardHeader title="General" />
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="siteName" label="Site name" error={errors?.siteName}>
              <Input id="siteName" name="siteName" defaultValue={values.siteName} required maxLength={100} />
            </Field>
            <Field id="portfolioUrl" label="Portfolio URL" error={errors?.portfolioUrl} hint="Used as the RSS channel link.">
              <Input id="portfolioUrl" name="portfolioUrl" type="url" defaultValue={values.portfolioUrl ?? ""} placeholder="https://yourname.dev" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Content rules" description="What counts as meaningful content when a URL is analysed." />
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Field id="minWordCount" label="Minimum word count" error={errors?.minWordCount} hint="Pages with less readable text are rejected. Projects use one third of this.">
            <Input id="minWordCount" name="minWordCount" type="number" min={20} max={5000} defaultValue={values.minWordCount} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Public timeline"
          description="A read-only page showing all your published work, newest first. Visitors can't log in or change anything."
          action={
            <a href={timelineUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
              Open <ArrowUpRight className="size-3.5" />
            </a>
          }
        />
        <CardContent className="space-y-5">
          <div className="divide-y">
            <ToggleRow name="timelineEnabled" title="Show public timeline" description={`Visible at ${timelineUrl.replace(/^https?:\/\//, "")}. When off, the page returns "Not found".`} defaultChecked={values.timelineEnabled} />
            <ToggleRow
              name="timelineIndexable"
              title="Let search engines index it"
              description="Off = unlisted: anyone with the link can view it, but Google won't list it."
              defaultChecked={values.timelineIndexable}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="profileName" label="Name" error={errors?.profileName} hint="Shown as the page title. Defaults to the site name.">
              <Input id="profileName" name="profileName" defaultValue={values.profileName ?? ""} maxLength={100} placeholder="Fahim Shahriar" />
            </Field>
            <Field id="profileTagline" label="One-line intro" error={errors?.profileTagline}>
              <Input id="profileTagline" name="profileTagline" defaultValue={values.profileTagline ?? ""} maxLength={200} placeholder="Software engineer writing about AI systems and the web." />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="profileGithub" label="GitHub" error={errors?.profileGithub}>
              <Input id="profileGithub" name="profileGithub" type="url" defaultValue={values.profileGithub ?? ""} placeholder="https://github.com/qwertyz15" />
            </Field>
            <Field id="profileLinkedin" label="LinkedIn" error={errors?.profileLinkedin}>
              <Input id="profileLinkedin" name="profileLinkedin" type="url" defaultValue={values.profileLinkedin ?? ""} placeholder="https://www.linkedin.com/in/…" />
            </Field>
            <Field id="profileX" label="X (Twitter)" error={errors?.profileX}>
              <Input id="profileX" name="profileX" type="url" defaultValue={values.profileX ?? ""} placeholder="https://x.com/…" />
            </Field>
            <Field id="profileWebsite" label="Website" error={errors?.profileWebsite}>
              <Input id="profileWebsite" name="profileWebsite" type="url" defaultValue={values.profileWebsite ?? ""} placeholder="https://fahimworks.dev" />
            </Field>
            <Field id="profileEmail" label="Email" error={errors?.profileEmail} hint="Shown as a mailto: link. Leave empty to hide.">
              <Input id="profileEmail" name="profileEmail" type="email" defaultValue={values.profileEmail ?? ""} placeholder="you@example.com" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Access & public API" />
        <CardContent className="divide-y py-1">
          <ToggleRow
            name="allowRegistration"
            title="Allow registration"
            description="Registration closed automatically when the admin account was created."
            warn="If enabled, anyone who can reach /register can create an Editor account (no admin permissions)."
            defaultChecked={values.allowRegistration}
          />
          <ToggleRow name="publicApiEnabled" title="Public content API & RSS" description="Serve published items at /api/public/content and /feed.xml for your portfolio." defaultChecked={values.publicApiEnabled} />
          <div className="py-3">
            <Field id="allowedOrigins" label="Allowed origins (CORS)" error={errors?.allowedOrigins ?? errors?.["allowedOrigins.0"]} hint="Origins permitted to call the public API from a browser, one per line. Server-side fetches don't need this.">
              <Textarea id="allowedOrigins" name="allowedOrigins" rows={3} defaultValue={values.allowedOrigins.join("\n")} placeholder="https://yourname.dev" className="font-mono text-[13px]" />
            </Field>
          </div>
        </CardContent>
        <CardFooter>
          <SubmitButton pending={pending} pendingText="Saving…">Save settings</SubmitButton>
        </CardFooter>
      </Card>
    </form>
  );
}
