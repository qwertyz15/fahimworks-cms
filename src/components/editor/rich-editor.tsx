"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notebookExtensions } from "./extensions";
import { SelectionToolbar, TableToolbar } from "./toolbars";
import { PICK_AUDIO_EVENT, PICK_FILE_EVENT, PICK_IMAGE_EVENT, PICK_VIDEO_EVENT } from "./slash-menu";
import { ACCEPTED_IMAGE_TYPES, ACCEPTED_TYPES, AUDIO_ACCEPT, FILE_ACCEPT, fileType, kindOf, uploadFile, uploadImage, type UploadKind, type UploadTarget } from "./upload";
import { parseVideoUrl } from "./rich-nodes";
import { blockBoundary, insertBlock } from "./blocks";
import { MathDialog } from "./math-dialog";
import { MermaidDialog } from "./mermaid-dialog";
import { LinkCardDialog, requestLinkCard } from "./link-card-dialog";

export interface EditorUploadConfig {
  enabled: boolean;
  /** Images. */
  maxBytes: number;
  /** Videos and file attachments. */
  maxMediaBytes: number;
}

/**
 * The block editor shared by Notebook entries and workspace pages: Tiptap +
 * every extension, paste/drop uploads, the pickers "/image", "/video",
 * "/audio" and "/file" open, and the video / equation / diagram / link-card
 * dialogs. The caller owns saving; `onChange` fires on every edit.
 */
export function useRichEditor(opts: {
  initialBody: JSONContent | null;
  uploads: EditorUploadConfig;
  /** Where uploads are recorded (entry or page id), read at upload time. */
  uploadTarget: () => UploadTarget;
  onChange: () => void;
  ariaLabel?: string;
}) {
  const { uploads } = opts;
  const [uploading, setUploading] = useState<{ count: number; pct: number } | null>(null);
  const [words, setWords] = useState(0);
  const bodyPicker = useRef<HTMLInputElement>(null);
  const videoPicker = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const audioPicker = useRef<HTMLInputElement>(null);
  const [videoDialog, setVideoDialog] = useState(false);
  /** Insert once the video dialog has closed (see Dialog's afterClose). */
  const afterVideoDialog = useRef<(() => void) | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  // Set below once the editor exists; used by paste/drop handlers created at init.
  const insertImagesRef = useRef<(files: File[], pos?: number) => void>(() => {});
  const insertVideoRef = useRef<(v: { provider: "youtube" | "vimeo"; id: string }) => void>(() => {});
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });

  const extensions = useMemo(() => notebookExtensions(), []);
  const editor = useEditor({
    extensions,
    content: opts.initialBody ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "notebook-editor prose-content", "aria-label": opts.ariaLabel ?? "Entry body" },
      // Paste or drop image files → upload to storage, then insert.
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length) {
          event.preventDefault();
          insertImagesRef.current(files);
          return true;
        }
        // A lone YouTube / Vimeo link becomes an embedded video.
        const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
        const video = !/\s/.test(text) ? parseVideoUrl(text) : null;
        if (video) {
          event.preventDefault();
          insertVideoRef.current(video);
          return true;
        }
        // A lone link on an empty line: paste it as usual, and offer a preview card.
        const { $from, empty } = view.state.selection;
        if (empty && /^https?:\/\/\S+$/i.test(text) && text.length <= 2000 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
          const replaceAt = $from.before();
          toast("Link pasted", {
            description: "Show it as a preview card instead?",
            action: { label: "Make it a card", onClick: () => requestLinkCard({ url: text, replaceAt, auto: true }) },
            duration: 8000,
          });
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        event.preventDefault();
        insertImagesRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
    onCreate: ({ editor: e }) => setWords((e.storage as { characterCount?: { words: () => number } }).characterCount?.words() ?? 0),
    onUpdate: ({ editor: e }) => {
      setWords((e.storage as { characterCount?: { words: () => number } }).characterCount?.words() ?? 0);
      latest.current.onChange();
    },
  });

  /**
   * Upload files one by one (images, videos, attachments — detected by type)
   * and insert each as the matching block at `pos` (or the cursor).
   */
  const insertImages = useCallback(
    async (files: File[], pos?: number, forceKind?: UploadKind) => {
      if (!editor) return;
      if (!uploads.enabled) {
        toast.error("Uploads aren't set up yet — add the S3_* variables in Vercel.");
        return;
      }
      let at = blockBoundary(editor.state.doc, pos ?? editor.state.selection.from);
      for (const [i, file] of files.entries()) {
        const kind = forceKind ?? kindOf(file);
        if (!kind) {
          toast.error(`“${file.name}” can't be added. Images: PNG/JPEG/WebP/GIF/AVIF · Videos: MP4/WebM · Audio: MP3/M4A/WAV/OGG · Files: PDF, ZIP, Office, CSV, TXT, MD, JSON.`);
          continue;
        }
        setUploading({ count: files.length - i, pct: 0 });
        try {
          const url = await uploadFile(file, kind, {
            ...latest.current.uploadTarget(),
            maxBytes: kind === "image" ? uploads.maxBytes : uploads.maxMediaBytes,
            onProgress: (pct) => setUploading({ count: files.length - i, pct }),
          });
          const node =
            kind === "image"
              ? { type: "image", attrs: { src: url, alt: file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || null } }
              : kind === "video"
                ? { type: "videoFile", attrs: { src: url } }
                : kind === "audio"
                  ? { type: "audioFile", attrs: { src: url } }
                  : { type: "attachment", attrs: { href: url, name: file.name, size: file.size, mime: fileType(file) } };
          insertBlock(editor, at, node);
          // Next one goes right after this one.
          at = blockBoundary(editor.state.doc, editor.state.selection.to);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Upload failed.");
        }
      }
      setUploading(null);
    },
    [editor, uploads.enabled, uploads.maxBytes, uploads.maxMediaBytes],
  );

  const insertVideo = useCallback(
    (v: { provider: "youtube" | "vimeo"; id: string }) => {
      if (!editor) return;
      insertBlock(editor, blockBoundary(editor.state.doc, editor.state.selection.from), { type: "videoEmbed", attrs: v });
    },
    [editor],
  );
  useLayoutEffect(() => {
    insertImagesRef.current = (files, pos) => void insertImages(files, pos);
    insertVideoRef.current = insertVideo;
  });

  // "/image", "/video", "/audio" and "/file" open the matching picker / dialog.
  useEffect(() => {
    const image = () => bodyPicker.current?.click();
    const file = () => filePicker.current?.click();
    const audio = () => audioPicker.current?.click();
    const video = () => {
      setVideoUrl("");
      setVideoDialog(true);
    };
    window.addEventListener(PICK_IMAGE_EVENT, image);
    window.addEventListener(PICK_FILE_EVENT, file);
    window.addEventListener(PICK_AUDIO_EVENT, audio);
    window.addEventListener(PICK_VIDEO_EVENT, video);
    return () => {
      window.removeEventListener(PICK_IMAGE_EVENT, image);
      window.removeEventListener(PICK_FILE_EVENT, file);
      window.removeEventListener(PICK_AUDIO_EVENT, audio);
      window.removeEventListener(PICK_VIDEO_EVENT, video);
    };
  }, []);

  /** Upload one image (e.g. a cover); resolves to its URL, or null on failure. */
  const uploadCoverImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!uploads.enabled) {
        toast.error("Image uploads aren't set up yet — add the S3_* variables in Vercel.");
        return null;
      }
      setUploading({ count: 1, pct: 0 });
      try {
        return await uploadImage(file, { ...latest.current.uploadTarget(), maxBytes: uploads.maxBytes, onProgress: (pct) => setUploading({ count: 1, pct }) });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
        return null;
      } finally {
        setUploading(null);
      }
    },
    [uploads.enabled, uploads.maxBytes],
  );

  const surface: ReactNode = editor ? (
    <>
      <SelectionToolbar editor={editor} />
      <TableToolbar editor={editor} />
      <EditorContent editor={editor} />
    </>
  ) : (
    <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-hidden />
  );

  const pick = (kind: UploadKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length) void insertImages(files, undefined, kind);
  };

  /** Hidden pickers + dialogs; render once, anywhere in the page. */
  const extras: ReactNode = (
    <>
      <input ref={bodyPicker} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} multiple hidden onChange={pick("image")} />
      <input ref={filePicker} type="file" accept={FILE_ACCEPT} multiple hidden onChange={pick("file")} />
      <input ref={audioPicker} type="file" accept={AUDIO_ACCEPT} hidden onChange={pick("audio")} />
      <Dialog
        open={videoDialog}
        onClose={() => setVideoDialog(false)}
        afterClose={() => {
          const run = afterVideoDialog.current;
          afterVideoDialog.current = null;
          run?.();
        }}
        title="Add a video"
        description="Paste a YouTube or Vimeo link, or upload an MP4 / WebM file."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => videoPicker.current?.click()} disabled={!uploads.enabled} title={uploads.enabled ? undefined : "Uploads aren't configured"}>
              Upload a file…
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const v = parseVideoUrl(videoUrl);
                if (!v) {
                  toast.error("That doesn't look like a YouTube or Vimeo link.");
                  return;
                }
                afterVideoDialog.current = () => insertVideo(v);
                setVideoDialog(false);
              }}
            >
              Embed link
            </Button>
          </>
        }
      >
        <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" aria-label="Video link" autoFocus />
        {/* Must live inside the modal: everything outside an open <dialog> is inert, so a picker there can't be opened. */}
        <input
          ref={videoPicker}
          type="file"
          accept={ACCEPTED_TYPES.video.join(",")}
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) afterVideoDialog.current = () => void insertImages(files, undefined, "video");
            setVideoDialog(false);
          }}
        />
      </Dialog>
      <MathDialog editor={editor} />
      <MermaidDialog editor={editor} />
      <LinkCardDialog editor={editor} />
    </>
  );

  return { editor: editor as Editor | null, words, uploading, uploadCoverImage, surface, extras };
}
