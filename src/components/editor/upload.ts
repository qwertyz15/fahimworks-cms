"use client";

import { createUploadAction } from "@/server/actions/notebook";

export type UploadKind = "image" | "video" | "audio" | "file";

/** Formats the server accepts per kind (mirrors lib/storage.ts). SVG/HTML/scripts are refused. */
export const ACCEPTED_TYPES: Record<UploadKind, string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"],
  video: ["video/mp4", "video/webm"],
  audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg"],
  file: [
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/csv",
    "text/plain",
    "text/markdown",
    "application/json",
  ],
};
export const ACCEPTED_IMAGE_TYPES = ACCEPTED_TYPES.image;

/** File picker `accept` for attachments (extensions help when the OS reports no MIME type). */
export const FILE_ACCEPT = [...ACCEPTED_TYPES.file, ".pdf", ".zip", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt", ".md", ".json"].join(",");

const EXT_TYPES: Record<string, string> = {
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

/** File picker `accept` for audio. */
export const AUDIO_ACCEPT = [...ACCEPTED_TYPES.audio, ".mp3", ".m4a", ".wav", ".ogg"].join(",");

/** The browser sometimes reports "" for .md etc. — fall back to the extension. */
export function fileType(file: File): string {
  if (file.type) return file.type;
  return EXT_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

/** Which kind an arbitrary dropped/pasted file is, or null if unsupported. */
export function kindOf(file: File): UploadKind | null {
  const t = fileType(file);
  if (ACCEPTED_TYPES.image.includes(t)) return "image";
  if (ACCEPTED_TYPES.video.includes(t)) return "video";
  if (ACCEPTED_TYPES.audio.includes(t)) return "audio";
  if (ACCEPTED_TYPES.file.includes(t)) return "file";
  return null;
}

export class UploadError extends Error {}

/** What an upload belongs to: a Notebook entry or a workspace page. */
export interface UploadTarget {
  contentId?: string | null;
  pageId?: string | null;
}

const NOUN: Record<UploadKind, string> = { image: "image", video: "video", audio: "audio file", file: "file" };
const HELP: Record<UploadKind, string> = {
  image: "Use PNG, JPEG, WebP, GIF or AVIF.",
  video: "Use MP4 or WebM (or paste a YouTube / Vimeo link).",
  audio: "Use MP3, M4A, WAV or OGG.",
  file: "Allowed: PDF, ZIP, Word, Excel, PowerPoint, CSV, TXT, Markdown, JSON.",
};

/**
 * Upload one file: ask the server for a presigned URL, then PUT it straight to
 * object storage (R2). Uses XHR for real upload progress. Resolves to the public URL.
 */
export async function uploadFile(
  file: File,
  kind: UploadKind,
  opts: UploadTarget & { maxBytes: number; onProgress?: (pct: number) => void },
): Promise<string> {
  const type = fileType(file);
  if (!ACCEPTED_TYPES[kind].includes(type)) throw new UploadError(`“${file.name}” isn't a supported ${NOUN[kind]}. ${HELP[kind]}`);
  if (file.size > opts.maxBytes) {
    throw new UploadError(`“${file.name}” is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${Math.round(opts.maxBytes / (1024 * 1024))} MB.`);
  }

  const res = await createUploadAction({ kind, filename: file.name || NOUN[kind], contentType: type, size: file.size, contentId: opts.contentId ?? null, pageId: opts.pageId ?? null });
  if (!res.ok || !res.data) throw new UploadError(res.ok ? "Could not start the upload." : res.error);
  const { uploadUrl, publicUrl, headers } = res.data;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(`Upload failed (HTTP ${xhr.status}).`)));
    xhr.onerror = () => reject(new UploadError("Upload failed — check your connection (or the bucket's CORS policy)."));
    xhr.send(file);
  });
  return publicUrl;
}

export const uploadImage = (file: File, opts: UploadTarget & { maxBytes: number; onProgress?: (pct: number) => void }) => uploadFile(file, "image", opts);
