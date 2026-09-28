"use client";

import { useActionState, useTransition, type FormEvent } from "react";
import type { ActionResult } from "@/server/actions/result";

/**
 * Like useActionState, but submits via onSubmit so React 19 does not reset the
 * form afterwards — users keep their input when validation fails.
 */
export function useFormAction<T>(action: (prev: ActionResult<T>, form: FormData) => Promise<ActionResult<T>>) {
  const [state, dispatch] = useActionState(action, { ok: false, error: "" } as ActionResult<T>);
  const [pending, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Include the clicked submit button (e.g. name="intent" value="publish").
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(data));
  };
  return { state, onSubmit, pending, errors: !state.ok ? state.fieldErrors : undefined };
}
