"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchLinkPreviewAction } from "@/server/actions/notebook";
import { blockBoundary, insertBlock } from "./blocks";

/** "/embed", or "Make it a card" after pasting a link. */
export const LINK_CARD_EVENT = "notebook:link-card";

export interface LinkCardRequest {
  url: string;
  /** Start of the paragraph holding the pasted link, to replace it with the card. */
  replaceAt?: number;
  /** Fetch straight away (the paste flow). */
  auto?: boolean;
}

export const requestLinkCard = (detail: LinkCardRequest) => window.dispatchEvent(new CustomEvent<LinkCardRequest>(LINK_CARD_EVENT, { detail }));

export function LinkCardDialog({ editor }: { editor: Editor | null }) {
  const [request, setRequest] = useState<LinkCardRequest | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const submitRef = useRef<(value: string, req: LinkCardRequest) => void>(() => {});

  const submit = async (value: string, req: LinkCardRequest) => {
    if (!editor) return;
    setLoading(true);
    setError(null);
    const res = await fetchLinkPreviewAction({ url: value.trim() });
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.ok ? "Couldn't load that page." : res.error);
      return;
    }
    const card = { type: "linkCard", attrs: res.data };
    pending.current = () => {
      const { doc } = editor.state;
      const para = req.replaceAt !== undefined ? doc.nodeAt(req.replaceAt) : null;
      // Replace the pasted link line only if it still holds just that link.
      if (para?.type.name === "paragraph" && para.textContent.trim() === req.url.trim()) {
        insertBlock(editor, { from: req.replaceAt!, to: req.replaceAt! + para.nodeSize }, card);
      } else {
        insertBlock(editor, blockBoundary(doc, editor.state.selection.from), card);
      }
    };
    setRequest(null);
  };
  useEffect(() => {
    submitRef.current = (v, r) => void submit(v, r);
  });

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<LinkCardRequest>).detail;
      setRequest(d);
      setUrl(d.url);
      setError(null);
      if (d.auto && d.url) submitRef.current(d.url, d);
    };
    window.addEventListener(LINK_CARD_EVENT, open);
    return () => window.removeEventListener(LINK_CARD_EVENT, open);
  }, []);

  return (
    <Dialog
      open={request !== null}
      onClose={() => setRequest(null)}
      afterClose={() => {
        const run = pending.current;
        pending.current = null;
        if (run) run();
        else editor?.commands.focus();
      }}
      title="Add a link card"
      description="A preview of a page — GitHub repo, website, article — with its title, description and image."
      footer={
        <Button size="sm" loading={loading} disabled={!url.trim()} onClick={() => request && void submit(url, { ...request, url })}>
          Create card
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (request && url.trim()) void submit(url, { ...request, url });
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/…" aria-label="Page link" type="url" autoFocus />
      </form>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </Dialog>
  );
}
