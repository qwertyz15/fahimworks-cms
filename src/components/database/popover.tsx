"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift, size, type Placement } from "@floating-ui/dom";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

/**
 * Floating panel anchored to an element (cell editors, menus). Rendered in a
 * portal; closes on outside click or Escape. Focus goes to the first
 * [data-autofocus] (or input) inside.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  placement = "bottom-start",
  className,
  label,
  matchWidth,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
  className?: string;
  label?: string;
  /** At least as wide as the anchor (cell editors). */
  matchWidth?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Portals need the DOM: false during server render, true in the browser.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !anchor || !el) return;
    return autoUpdate(anchor, el, () => {
      void computePosition(anchor, el, {
        placement,
        strategy: "fixed",
        middleware: [
          offset(4),
          flip(),
          shift({ padding: 8 }),
          ...(matchWidth ? [size({
                apply: ({ rects }) => {
                  el.style.minWidth = `${rects.reference.width}px`;
                },
              })] : []),
        ],
      }).then(({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }));
    });
  }, [open, anchor, placement, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const focus = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("input, textarea, select, button");
    focus?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (el?.contains(t) || anchor?.contains(t)) return;
      // Clicks inside another popover opened from this one don't close it.
      if ((t as HTMLElement).closest?.("[data-popover]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    el?.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      el?.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div
      ref={ref}
      data-popover
      role="dialog"
      aria-label={label}
      style={{ position: "fixed", left: 0, top: 0 }}
      className={cn("z-50 max-h-[70vh] overflow-auto rounded-lg border bg-surface p-1.5 text-sm shadow-pop", className)}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A button that opens a popover below itself. */
export function PopoverButton({
  label,
  children,
  content,
  className,
  panelClassName,
  placement,
  title,
}: {
  label: string;
  children: ReactNode;
  content: (close: () => void) => ReactNode;
  className?: string;
  panelClassName?: string;
  placement?: Placement;
  title?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={setAnchor} type="button" aria-label={label} title={title ?? label} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={className}>
        {children}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={label} className={panelClassName} placement={placement}>
        {content(() => setOpen(false))}
      </Popover>
    </>
  );
}
