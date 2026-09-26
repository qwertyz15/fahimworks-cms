"use client";

import { registerAction } from "@/server/actions/auth";
import { Field, FormAlert } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFormAction } from "@/components/use-form-action";

export function RegisterForm() {
  const { state, onSubmit, pending, errors } = useFormAction(registerAction);

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {!state.ok && <FormAlert message={state.error} />}
      <Field id="name" label="Name" error={errors?.name}>
        <Input id="name" name="name" autoComplete="name" required autoFocus aria-invalid={Boolean(errors?.name)} />
      </Field>
      <Field id="email" label="Email" error={errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors?.email)} />
      </Field>
      <Field id="password" label="Password" error={errors?.password} hint="At least 12 characters with upper- and lower-case letters and a number or symbol.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(errors?.password)} />
      </Field>
      <Field id="confirmPassword" label="Confirm password" error={errors?.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors?.confirmPassword)} />
      </Field>
      <SubmitButton pending={pending} className="w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
