/**
 * What the image viewer can open, and which clicks open it. Images keep
 * their own behaviour when they're inside a link, a button, a link card or a
 * video embed. In the editor an image opens on double-click (a click selects
 * it); elsewhere a click opens it.
 */

export type ViewerTarget =
  | { kind: "img"; src: string; alt: string; caption: string | null; width: number; height: number }
  | { kind: "svg"; svg: SVGSVGElement; alt: string; caption: string | null; width: number; height: number };

export const OPEN_VIEWER_EVENT = "image-viewer:open";

/** Open the viewer from code (e.g. an "Expand" button). */
export function openImageViewer(target: ViewerTarget) {
  window.dispatchEvent(new CustomEvent<ViewerTarget>(OPEN_VIEWER_EVENT, { detail: target }));
}

const SKIP = "a[href], button, [role='button'], [data-no-zoom], .link-card, [data-video-embed]";
/** Images too small to be worth enlarging (icons, avatars). */
const MIN_SIZE = 48;

const captionOf = (el: Element) => el.closest("figure")?.querySelector("figcaption")?.textContent?.trim() || null;

export function imageTarget(img: HTMLImageElement): ViewerTarget | null {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!img.currentSrc && !img.src) return null;
  return { kind: "img", src: img.currentSrc || img.src, alt: img.alt, caption: captionOf(img), width, height };
}

export function svgTarget(svg: SVGSVGElement, alt = "Diagram"): ViewerTarget | null {
  const vb = svg.viewBox?.baseVal;
  const box = svg.getBoundingClientRect();
  const width = vb && vb.width ? vb.width : box.width;
  const height = vb && vb.height ? vb.height : box.height;
  if (!width || !height) return null;
  return { kind: "svg", svg, alt, caption: captionOf(svg), width, height };
}

/** The viewer target for a click / double-click on `el`, if it should open one. */
export function targetFromEvent(el: EventTarget | null, kind: "click" | "dblclick"): ViewerTarget | null {
  if (!(el instanceof Element)) return null;
  const editorRoot = el.closest(".ProseMirror");
  const editing = editorRoot?.getAttribute("contenteditable") === "true";

  const img = el.closest("img");
  if (img) {
    if (img.closest(SKIP)) return null;
    // In the editor only image blocks open (not video thumbnails, link previews…).
    const eligible = editorRoot ? !!img.closest(".notebook-figure") : img.hasAttribute("data-zoomable") || !!img.closest(".prose-content");
    if (!eligible || (editing ? kind !== "dblclick" : kind !== "click")) return null;
    if ((img.naturalWidth || img.width) < MIN_SIZE && (img.naturalHeight || img.height) < MIN_SIZE) return null;
    return imageTarget(img);
  }
  // Diagrams drawn on published pages (the editor has its own Expand button).
  const diagram = el.closest("figure.mermaid-rendered");
  if (diagram && kind === "click") {
    const svg = diagram.querySelector("svg");
    return svg ? svgTarget(svg) : null;
  }
  return null;
}
