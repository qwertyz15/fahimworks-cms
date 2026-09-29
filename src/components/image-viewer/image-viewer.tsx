"use client";

/* eslint-disable @next/next/no-img-element -- shows the page's own image at full resolution */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus, X } from "lucide-react";
import { OPEN_VIEWER_EVENT, targetFromEvent, type ViewerTarget } from "./targets";

/**
 * Full-screen image viewer, mounted once for the whole app. Opens from clicks
 * on content images (see targets.ts) or openImageViewer(). Zoom sets the
 * image's real width and height (never a scale transform), so photos stay
 * sharp up to full resolution and diagrams stay vector-sharp.
 */
export function ImageViewer() {
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const open = (t: ViewerTarget) => {
      opener.current = document.activeElement;
      setTarget(t);
    };
    const handler = (kind: "click" | "dblclick") => (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = targetFromEvent(e.target, kind);
      if (!t) return;
      e.preventDefault();
      open(t);
    };
    const onClick = handler("click");
    const onDbl = handler("dblclick");
    const onOpen = (e: Event) => open((e as CustomEvent<ViewerTarget>).detail);
    document.addEventListener("click", onClick);
    document.addEventListener("dblclick", onDbl);
    window.addEventListener(OPEN_VIEWER_EVENT, onOpen);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("dblclick", onDbl);
      window.removeEventListener(OPEN_VIEWER_EVENT, onOpen);
    };
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    const el = opener.current;
    if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
  }, []);

  return target ? <Lightbox key={target.kind === "img" ? target.src : "svg"} target={target} onClose={close} /> : null;
}

// ── Lightbox ───────────────────────────────────────────────────────────────

interface View {
  /** Size multiplier: 1 = natural size. */
  s: number;
  /** Offset of the image centre from the screen centre (px). */
  x: number;
  y: number;
}

const WHEEL_ZOOM = 0.0022;
const PINCH_WHEEL_ZOOM = 0.012;
const DOUBLE_TAP_MS = 300;
const SWIPE_CLOSE_PX = 110;

function Lightbox({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: target.width, h: target.height });
  const [label, setLabel] = useState("");
  const view = useRef<View>({ s: 1, x: 0, y: 0 });
  const limits = useRef({ fit: 1, min: 1, max: 4 });
  const frame = useRef(0);
  const reduced = useRef(false);

  // ── Geometry ──
  const measure = useCallback(() => {
    const narrow = innerWidth < 640;
    const padX = narrow ? 12 : 64;
    const padY = narrow ? 64 : 88;
    const { w, h } = natural;
    const fitScreen = Math.min((innerWidth - padX * 2) / w, (innerHeight - padY * 2) / h);
    // Photos never upscale to fit; diagrams (vectors) may.
    const fit = target.kind === "img" ? Math.min(1, fitScreen) : Math.min(fitScreen, 4);
    limits.current = { fit, min: fit, max: Math.max(fit * 8, target.kind === "img" ? 4 : 0) };
  }, [natural, target.kind]);

  const clamp = useCallback(
    (v: View): View => {
      const { min, max, fit } = limits.current;
      const s = Math.min(max, Math.max(min, v.s));
      // Back at fit size: centred.
      if (s <= fit * 1.001) return { s, x: 0, y: 0 };
      const w = natural.w * s;
      const h = natural.h * s;
      // Larger than the screen: pan up to its edges (+ a little air). Smaller: it may move
      // (zooming towards the cursor) but stays on screen.
      const lim = (size: number, screen: number) => (size > screen ? (size - screen) / 2 + 24 : (screen - size) / 2);
      const limX = lim(w, innerWidth);
      const limY = lim(h, innerHeight);
      return { s, x: Math.min(limX, Math.max(-limX, v.x)), y: Math.min(limY, Math.max(-limY, v.y)) };
    },
    [natural],
  );

  /** Write the view to the DOM (on the next frame, or animated). */
  const apply = useCallback(
    (v: View, animate = false) => {
      view.current = v;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const el = media.current;
        if (!el) return;
        el.style.transition = animate && !reduced.current ? "width 220ms ease, height 220ms ease, transform 220ms ease" : "none";
        el.style.width = `${natural.w * v.s}px`;
        el.style.height = `${natural.h * v.s}px`;
        el.style.transform = `translate(-50%, -50%) translate(${v.x}px, ${v.y}px)`;
        const { fit } = limits.current;
        setLabel(Math.abs(v.s - fit) < 0.005 ? "Fit" : `${Math.round((target.kind === "img" ? v.s : v.s / fit) * 100)}%`);
      });
    },
    [natural, target.kind],
  );

  const fitView = useCallback(
    (animate = true) => {
      measure();
      apply({ s: limits.current.fit, x: 0, y: 0 }, animate);
    },
    [measure, apply],
  );

  /** Zoom to `s`, keeping the screen point (px, py) still. */
  const zoomAt = useCallback(
    (s: number, px = innerWidth / 2, py = innerHeight / 2, animate = false) => {
      const v = view.current;
      const next = Math.min(limits.current.max, Math.max(limits.current.min, s));
      const r = next / v.s;
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      apply(clamp({ s: next, x: px - cx - (px - cx - v.x) * r, y: py - cy - (py - cy - v.y) * r }), animate);
    },
    [apply, clamp],
  );

  const zoomed = () => view.current.s > limits.current.fit * 1.01;

  // ── Open / close ──
  useLayoutEffect(() => {
    reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = overflow;
      if (d?.open) d.close();
    };
  }, []);

  // A diagram: show a copy of the page's SVG, sized by its box.
  useLayoutEffect(() => {
    if (target.kind !== "svg" || !media.current) return;
    const copy = target.svg.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute("style");
    copy.setAttribute("width", "100%");
    copy.setAttribute("height", "100%");
    copy.setAttribute("preserveAspectRatio", "xMidYMid meet");
    copy.style.display = "block";
    media.current.replaceChildren(copy);
  }, [target]);

  useLayoutEffect(() => {
    fitView(false);
    const onResize = () => {
      const wasFit = !zoomed();
      measure();
      if (wasFit) apply({ s: limits.current.fit, x: 0, y: 0 });
      else apply(clamp(view.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fit when the natural size is known
  }, [natural]);

  // ── Keyboard ──
  useEffect(() => {
    const d = dialog.current;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const v = view.current;
      if (e.key === "+" || e.key === "=") zoomAt(v.s * 1.5, undefined, undefined, true);
      else if (e.key === "-" || e.key === "_") zoomAt(v.s / 1.5, undefined, undefined, true);
      else if (e.key === "0") fitView();
      else if (e.key.startsWith("Arrow")) {
        const step = 80;
        const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        apply(clamp({ ...v, x: v.x + dx, y: v.y + dy }), true);
      } else return;
      e.preventDefault();
    };
    // On the window: the viewer is modal, so every key is for it (wherever focus is).
    d?.addEventListener("cancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      d?.removeEventListener("cancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [apply, clamp, fitView, onClose, zoomAt]);

  // ── Wheel: mouse wheel and trackpad pinch zoom; two-finger trackpad pans when zoomed ──
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (!e.ctrlKey && !e.metaKey && dx !== 0 && zoomed()) {
        const v = view.current;
        apply(clamp({ ...v, x: v.x - dx, y: v.y - dy }));
        return;
      }
      const k = e.ctrlKey || e.metaKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM;
      zoomAt(view.current.s * Math.exp(-dy * k), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, clamp, zoomAt]);

  // ── Pointers: drag to pan, pinch to zoom, double-tap / double-click, swipe down to close ──
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const gesture = useRef<
    | { kind: "drag"; id: number; x0: number; y0: number; v0: View; moved: boolean; onMedia: boolean; swipe: boolean }
    | { kind: "pinch"; d0: number; m0: { x: number; y: number }; v0: View }
    | null
  >(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });

  const backdrop = (opacity: number) => {
    if (dialog.current) dialog.current.style.setProperty("--viewer-dim", String(opacity));
  };

  const startDrag = (id: number, x: number, y: number, onMedia: boolean) => {
    gesture.current = { kind: "drag", id, x0: x, y0: y, v0: { ...view.current }, moved: false, onMedia, swipe: false };
  };
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...view.current } };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.current.size === 1) startDrag(e.pointerId, e.clientX, e.clientY, !!media.current?.contains(e.target as Node));
    else if (pointers.current.size === 2) startPinch();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const cx = innerWidth / 2;
      const cy = innerHeight / 2;
      const s = Math.min(limits.current.max, Math.max(limits.current.min, (g.v0.s * d) / g.d0));
      const r = s / g.v0.s;
      apply(clamp({ s, x: m.x - cx - (g.m0.x - cx - g.v0.x) * r, y: m.y - cy - (g.m0.y - cy - g.v0.y) * r }));
      return;
    }
    if (g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) > 5) {
      g.moved = true;
      // At fit size, a mostly-downward touch drag is "swipe to close".
      g.swipe = !zoomed() && e.pointerType === "touch" && Math.abs(dy) > Math.abs(dx);
    }
    if (!g.moved) return;
    if (g.swipe) {
      apply({ ...g.v0, y: g.v0.y + dy });
      backdrop(Math.max(0.25, 1 - Math.abs(dy) / 400));
    } else if (zoomed() || natural.w * view.current.s > innerWidth || natural.h * view.current.s > innerHeight) {
      apply(clamp({ ...g.v0, x: g.v0.x + dx, y: g.v0.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g?.kind === "pinch") {
      // One finger left: carry on panning with it.
      const [rest] = [...pointers.current.entries()];
      if (rest) startDrag(rest[0], rest[1].x, rest[1].y, true);
      else gesture.current = null;
      return;
    }
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (g.swipe) {
      const dy = e.clientY - g.y0;
      if (Math.abs(dy) > SWIPE_CLOSE_PX) return onClose();
      backdrop(1);
      apply({ ...g.v0 }, true);
      return;
    }
    if (g.moved || e.type === "pointercancel") return;
    // A tap / click.
    const now = performance.now();
    const t = lastTap.current;
    const double = now - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30;
    lastTap.current = { t: double ? 0 : now, x: e.clientX, y: e.clientY };
    if (double && g.onMedia) {
      if (zoomed()) fitView();
      else {
        const { fit } = limits.current;
        zoomAt(Math.max(fit * 2.5, target.kind === "img" ? 1 : 0), e.clientX, e.clientY, true);
      }
      return;
    }
    if (!g.onMedia) onClose();
  };

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && (img.naturalWidth !== natural.w || img.naturalHeight !== natural.h)) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const btn = "flex size-9 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white";
  const caption = target.caption || (target.kind === "img" ? target.alt : "") || "";

  return (
    <dialog ref={dialog} className="image-viewer" aria-label={caption ? `Image: ${caption}` : "Image viewer"} data-testid="image-viewer">
      <div
        ref={stage}
        className="absolute inset-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="image-viewer-stage"
      >
        <div ref={media} className="image-viewer-media absolute top-1/2 left-1/2" data-testid="image-viewer-media">
          {target.kind === "img" && <img src={target.src} alt={target.alt} draggable={false} onLoad={onImgLoad} className="block size-full" decoding="async" />}
        </div>
      </div>

      <button type="button" autoFocus onClick={onClose} aria-label="Close" title="Close (Esc)" className={`${btn} absolute top-3 right-3 bg-black/40`}>
        <X className="size-5" />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-3">
        {caption && <p className="max-w-2xl truncate rounded-full bg-black/50 px-3 py-1 text-center text-[13px] text-white/90">{caption}</p>}
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/60 p-1 backdrop-blur" role="toolbar" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt(view.current.s / 1.5, undefined, undefined, true)} aria-label="Zoom out" title="Zoom out (−)" className={btn}>
            <Minus className="size-4" />
          </button>
          <span className="w-14 text-center text-xs text-white/85 tabular-nums" aria-live="polite" data-testid="image-viewer-zoom">
            {label}
          </span>
          <button type="button" onClick={() => zoomAt(view.current.s * 1.5, undefined, undefined, true)} aria-label="Zoom in" title="Zoom in (+)" className={btn}>
            <Plus className="size-4" />
          </button>
          <button type="button" onClick={() => fitView()} aria-label="Fit to screen" title="Fit to screen (0)" className={btn}>
            <Maximize className="size-4" />
          </button>
        </div>
      </div>
    </dialog>
  );
}
