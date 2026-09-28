"use client";

import { useEffect } from "react";
import { toast } from "sonner";
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

export function SettingsForm({ values }: { values: SettingsValues }) {
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
