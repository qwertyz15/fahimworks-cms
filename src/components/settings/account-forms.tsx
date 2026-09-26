"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { changePasswordAction, signOutEverywhereAction } from "@/server/actions/settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormAlert } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { useRunAction } from "@/components/use-action-toast";
import { useFormAction } from "@/components/use-form-action";

export function ChangePasswordForm() {
  const { state, onSubmit, pending, errors } = useFormAction(changePasswordAction);
  return (
    <Card>
      <CardHeader title="Change password" description="You'll be signed out of every session after changing it." />
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          {!state.ok && <FormAlert message={state.error} />}
          <Field id="currentPassword" label="Current password" error={errors?.currentPassword}>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="newPassword" label="New password" error={errors?.newPassword} hint="12+ characters, mixed case, number or symbol.">
              <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
            </Field>
            <Field id="confirmPassword" label="Confirm new password" error={errors?.confirmPassword}>
              <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            </Field>
          </div>
        </CardContent>
        <CardFooter>
          <SubmitButton pending={pending} pendingText="Updating…">Update password</SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}

export function SessionsCard() {
  const [open, setOpen] = useState(false);
  const { run, pending } = useRunAction();
  return (
    <Card>
      <CardHeader title="Sessions" description="Sessions last 7 days. Revoke all of them if you signed in on a device you no longer trust." />
      <CardFooter className="justify-start">
        <Button variant="outline" onClick={() => setOpen(true)}>
          <LogOut /> Sign out everywhere
        </Button>
      </CardFooter>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Sign out of all sessions?"
        description="Every device, including this one, will need to sign in again."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" loading={pending} onClick={() => run(() => signOutEverywhereAction())}>
              Sign out everywhere
            </Button>
          </>
        }
      />
    </Card>
  );
}
