import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Checkbox styled as a switch — works in plain HTML forms (value "on"). */
export function Switch({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={cn(
        "relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors checked:bg-primary",
        "before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-4",
        className,
      )}
      {...props}
    />
  );
}
