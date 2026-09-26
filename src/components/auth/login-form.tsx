"use client";

import { loginAction } from "@/server/actions/auth";
import { Field, FormAlert } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFormAction } from "@/components/use-form-action";

export function LoginForm({ callbackUrl, notice }: { callbackUrl?: string; notice?: string }) {
  const { state, onSubmit, pending, errors } = useFormAction(loginAction);

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {notice && !(!state.ok && state.error) && <FormAlert tone="info" message={notice} />}
      {!state.ok && <FormAlert message={state.error} />}
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/dashboard"} />
      <Field id="email" label="Email" error={errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus aria-invalid={Boolean(errors?.email)} />
      </Field>
      <Field id="password" label="Password" error={errors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(errors?.password)} />
      </Field>
      <SubmitButton pending={pending} className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
