"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { JSONContent } from "@tiptap/react";
import { getPageAction } from "@/server/actions/databases";
import type { EditorUploadConfig } from "@/components/editor/rich-editor";
import { PageEditor, type PageEditorData } from "./page-editor";
import type { PropertyValue } from "@/lib/db-properties";
import type { Row } from "./types";

const noopSubscribe = () => () => {};

/**
 * A row page in a side panel over the database. The editor inside is only
 * mounted while the panel is open (one editor on screen at a time).
 */
export function PeekPanel({
  pageId,
  uploads,
  articleBaseUrl,
  onClose,
  onOpenFull,
  onRowChange,
}: {
  pageId: string;
  uploads: EditorUploadConfig;
  articleBaseUrl: string;
  onClose: () => void;
  onOpenFull: () => void;
  onRowChange: (row: Row) => void;
}) {
  const [data, setData] = useState<{ id: string; value: PageEditorData | null; error?: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void getPageAction({ id: pageId }).then((res) => {
      if (!alive) return;
      if (!res.ok || !res.data) return setData({ id: pageId, value: null, error: res.ok ? "Could not open the page." : res.error });
      const d = res.data;
      setData({
        id: pageId,
        value: { ...d, page: { ...d.page, body: (d.page.body as JSONContent | null) ?? null, values: d.page.values as Record<string, PropertyValue> } },
      });
    });
    return () => {
      alive = false;
    };
  }, [pageId]);

  // Esc closes, unless it's meant for something inside (a menu, a dialog, the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest(".notebook-editor, [data-popover], dialog[open], [role='listbox']") || document.querySelector("dialog[open], [data-popover]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = data?.id === pageId ? data : null;
  // Portals need the DOM: nothing during server render (the page may load with ?p=).
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-black/20" onMouseDown={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label="Page"
        data-testid="peek-panel"
        className="absolute top-0 right-0 bottom-0 flex w-full max-w-3xl flex-col overflow-y-auto border-l bg-background shadow-pop peek-in"
      >
        {!ready ? (
          <div className="space-y-4 p-6" aria-busy>
            <div className="h-8 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-40 animate-pulse rounded bg-muted/60" />
          </div>
        ) : ready.value ? (
          <PageEditor key={pageId} data={ready.value} uploads={uploads} articleBaseUrl={articleBaseUrl} variant="peek" onClose={onClose} onOpenFull={onOpenFull} onRowChange={onRowChange} />
        ) : (
          <p className="p-6 text-sm text-destructive">{ready.error}</p>
        )}
      </aside>
    </div>,
    document.body,
  );
}
