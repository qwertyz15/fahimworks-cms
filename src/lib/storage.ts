import "server-only";
import { randomBytes } from "node:crypto";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { slugify } from "@/lib/utils";

/**
 * S3-compatible object storage (Cloudflare R2 in production) for Notebook
 * images. The browser uploads straight to the bucket with a short-lived
 * presigned PUT, so image bytes never pass through the app (no Vercel
 * request-size limits).
 */

/** Raster formats only. SVG is refused: it can carry scripts. */
export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

/**
 * Downloadable attachments. Anything a browser could render as a page or run
 * (HTML, SVG, JS, executables) is excluded — that allowlist is the protection.
 * (No Content-Disposition header: it would also have to be allowed in the
 * bucket's CORS policy for browser uploads.)
 */
export const FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/json": "json",
};

export type UploadKind = "image" | "video" | "audio" | "file";

const KIND_TYPES: Record<UploadKind, Record<string, string>> = { image: IMAGE_TYPES, video: VIDEO_TYPES, audio: AUDIO_TYPES, file: FILE_TYPES };
const KIND_ERROR: Record<UploadKind, string> = {
  image: "Only PNG, JPEG, WebP, GIF and AVIF images can be uploaded.",
  video: "Only MP4 and WebM videos can be uploaded.",
  audio: "Only MP3, M4A, WAV and OGG audio can be uploaded.",
  file: "That file type can't be attached. Allowed: PDF, ZIP, Word, Excel, PowerPoint, CSV, TXT, Markdown, JSON.",
};

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  maxBytes: number;
  maxMediaBytes: number;
}

function config(): StorageConfig | null {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY || !e.S3_PUBLIC_URL) return null;
  return {
    endpoint: e.S3_ENDPOINT.replace(/\/+$/, ""),
    region: e.S3_REGION || "auto",
    bucket: e.S3_BUCKET,
    accessKeyId: e.S3_ACCESS_KEY_ID,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    publicUrl: e.S3_PUBLIC_URL.replace(/\/+$/, ""),
    maxBytes: e.UPLOAD_MAX_BYTES,
    maxMediaBytes: e.UPLOAD_MAX_MEDIA_BYTES,
  };
}

export function uploadsEnabled(): boolean {
  return config() !== null;
}

export function uploadLimitBytes(): number {
  return env().UPLOAD_MAX_BYTES;
}

/** Limit for videos and file attachments. */
export function mediaUploadLimitBytes(): number {
  return env().UPLOAD_MAX_MEDIA_BYTES;
}

/** Origin the browser uploads to (CSP connect-src). Reads process.env directly: used in proxy.ts. */
export function storageUploadOrigin(): string | null {
  try {
    return process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : null;
  } catch {
    return null;
  }
}

/** Origin images are served from (CSP img-src, sanitiser allowlist). */
export function storagePublicOrigin(): string | null {
  try {
    return process.env.S3_PUBLIC_URL ? new URL(process.env.S3_PUBLIC_URL).origin : null;
  } catch {
    return null;
  }
}

let client: S3Client | undefined;
function s3(cfg: StorageConfig) {
  client ??= new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    // Path-style keeps the upload origin equal to the endpoint (simple CSP + CORS).
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return client;
}

/** posts/2026/09/k3j9x1a2-my-diagram.png — unique, readable, grouped by month. */
export function objectKey(filename: string, contentType: string, now = new Date(), kind: UploadKind = "image"): string {
  const ext = KIND_TYPES[kind][contentType];
  if (!ext) throw new StorageError(KIND_ERROR[kind]);
  const base = slugify(filename.replace(/\.[a-z0-9]+$/i, ""), 40) || "image";
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `posts/${now.getUTCFullYear()}/${month}/${randomBytes(4).toString("hex")}-${base}.${ext}`;
}

export interface PresignedUpload {
  key: string;
  uploadUrl: string;
  publicUrl: string;
  /** Headers the browser must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
}

export async function presignUpload(input: { filename: string; contentType: string; size: number; kind?: UploadKind }): Promise<PresignedUpload> {
  const kind = input.kind ?? "image";
  const cfg = config();
  if (!cfg) throw new StorageError("Uploads aren't configured yet (S3_* environment variables).");
  if (!KIND_TYPES[kind][input.contentType]) throw new StorageError(KIND_ERROR[kind]);
  if (!Number.isInteger(input.size) || input.size <= 0) throw new StorageError("The file is empty.");
  const limit = kind === "image" ? cfg.maxBytes : cfg.maxMediaBytes;
  const label = kind === "image" ? "Images" : kind === "video" ? "Videos" : kind === "audio" ? "Audio files" : "Files";
  if (input.size > limit) throw new StorageError(`${label} must be ${Math.round(limit / (1024 * 1024))} MB or smaller.`);

  const key = objectKey(input.filename, input.contentType, new Date(), kind);
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: input.contentType,
    // Signed: the URL only accepts exactly this size and type.
    ContentLength: input.size,
    CacheControl: "public, max-age=31536000, immutable",
  });
  // Videos can be large on slow links, so their URL lives a little longer.
  const uploadUrl = await getSignedUrl(s3(cfg), command, { expiresIn: kind === "image" ? 300 : 900 });
  return {
    key,
    uploadUrl,
    publicUrl: `${cfg.publicUrl}/${key}`,
    headers: { "content-type": input.contentType },
  };
}

/** Back-compat wrapper (images). */
export const presignImageUpload = (input: { filename: string; contentType: string; size: number }) => presignUpload({ ...input, kind: "image" });

/** Delete objects by key (batched). Missing keys are ignored by S3/R2. */
export async function deleteObjects(keys: string[]) {
  const cfg = config();
  if (!cfg || keys.length === 0) return;
  for (let i = 0; i < keys.length; i += 1000) {
    await s3(cfg).send(
      new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }),
    );
  }
}
