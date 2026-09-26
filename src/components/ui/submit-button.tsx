"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

export function SubmitButton({ children, pendingText, pending, ...props }: ButtonProps & { pendingText?: string; pending?: boolean }) {
  const status = useFormStatus();
  const busy = pending ?? status.pending;
  return (
    <Button type="submit" loading={busy} {...props}>
      {busy && pendingText ? pendingText : children}
    </Button>
  );
}
