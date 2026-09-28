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
  };
}

export function uploadsEnabled(): boolean {
  return config() !== null;
}

export function uploadLimitBytes(): number {
  return env().UPLOAD_MAX_BYTES;
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
export function objectKey(filename: string, contentType: string, now = new Date()): string {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new StorageError("Only PNG, JPEG, WebP, GIF and AVIF images can be uploaded.");
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

export async function presignImageUpload(input: { filename: string; contentType: string; size: number }): Promise<PresignedUpload> {
  const cfg = config();
  if (!cfg) throw new StorageError("Image uploads aren't configured yet (S3_* environment variables).");
  if (!IMAGE_TYPES[input.contentType]) throw new StorageError("Only PNG, JPEG, WebP, GIF and AVIF images can be uploaded.");
  if (!Number.isInteger(input.size) || input.size <= 0) throw new StorageError("The file is empty.");
  if (input.size > cfg.maxBytes) throw new StorageError(`Images must be ${Math.round(cfg.maxBytes / (1024 * 1024))} MB or smaller.`);

  const key = objectKey(input.filename, input.contentType);
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: input.contentType,
    // Signed: the URL only accepts exactly this size and type.
    ContentLength: input.size,
    CacheControl: "public, max-age=31536000, immutable",
  });
  const uploadUrl = await getSignedUrl(s3(cfg), command, { expiresIn: 300 });
  return { key, uploadUrl, publicUrl: `${cfg.publicUrl}/${key}`, headers: { "content-type": input.contentType } };
}

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
