"use client";

import { createImageUploadAction } from "@/server/actions/notebook";

/** Formats the server accepts (SVG is refused: it can carry scripts). */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

export class UploadError extends Error {}

/**
 * Upload one image: ask the server for a presigned URL, then PUT the file
 * straight to object storage (R2). Uses XHR for real upload progress.
 * Resolves to the public image URL.
 */
export async function uploadImage(file: File, opts: { contentId?: string | null; maxBytes: number; onProgress?: (pct: number) => void }): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new UploadError(`“${file.name}” isn't a supported image. Use PNG, JPEG, WebP, GIF or AVIF.`);
  }
  if (file.size > opts.maxBytes) {
    throw new UploadError(`“${file.name}” is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is ${Math.round(opts.maxBytes / (1024 * 1024))} MB.`);
  }

  const res = await createImageUploadAction({ filename: file.name || "image", contentType: file.type, size: file.size, contentId: opts.contentId ?? null });
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
