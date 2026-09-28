"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accessible modal built on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  afterClose,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Runs right after the dialog closes (and the browser has moved focus back).
   * Use it for editor commands: run earlier, that focus restore would reset the caret.
   */
  afterClose?: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const afterCloseRef = useRef(afterClose);
  useEffect(() => {
    afterCloseRef.current = afterClose;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) {
      el.close();
      afterCloseRef.current?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      // The native "close" event is queued; ignore a stale one that lands after a quick re-open.
      onClose={() => !ref.current?.open && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn("m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-surface p-0 text-foreground shadow-pop", className)}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      {children && <div className="px-5 pt-4">{children}</div>}
      {footer && <div className="mt-5 flex justify-end gap-2 border-t bg-surface-2/60 px-5 py-3">{footer}</div>}
    </dialog>
  );
}
