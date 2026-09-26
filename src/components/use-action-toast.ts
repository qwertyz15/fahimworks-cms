"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/result";

/** Run a server action from an event handler and surface its result as a toast. */
export function useRunAction() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult<unknown>>, opts: { onSuccess?: () => void; redirectTo?: string } = {}) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        opts.onSuccess?.();
        if (opts.redirectTo) router.push(opts.redirectTo);
      } else {
        toast.error(res.error || "Something went wrong.");
      }
    });
  return { pending, run };
}
