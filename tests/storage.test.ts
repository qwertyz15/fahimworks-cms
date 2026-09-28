import { beforeEach, describe, expect, it } from "vitest";
import { StorageError, objectKey, presignImageUpload } from "@/lib/storage";
import { sanitizeNotebookHtml } from "@/server/services/notebook-html";

describe("objectKey", () => {
  it("builds a unique, readable key grouped by month", () => {
    const key = objectKey("My Diagram (final).PNG", "image/png", new Date("2026-09-28T12:00:00Z"));
    expect(key).toMatch(/^posts\/2026\/09\/[0-9a-f]{8}-my-diagram-final\.png$/);
  });

  it("uses the extension of the real content type, not the filename", () => {
    expect(objectKey("photo.png", "image/jpeg")).toMatch(/\.jpg$/);
  });

  it.each(["image/svg+xml", "text/html", "application/pdf", ""])("refuses %j", (type) => {
    expect(() => objectKey("x", type)).toThrow(StorageError);
  });
});

describe("presignImageUpload", () => {
  beforeEach(() => {
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://x", AUTH_SECRET: "x".repeat(40),
      S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", S3_BUCKET: "media", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret",
      S3_PUBLIC_URL: "https://media.example.dev", S3_REGION: "auto", UPLOAD_MAX_BYTES: String(1024 * 1024),
    });
  });

  it("returns a signed PUT URL bound to size and type, and the public URL", async () => {
    const up = await presignImageUpload({ filename: "shot.png", contentType: "image/png", size: 1234 });
    expect(up.publicUrl).toMatch(/^https:\/\/media\.example\.dev\/posts\/\d{4}\/\d{2}\/[0-9a-f]{8}-shot\.png$/);
    const u = new URL(up.uploadUrl);
    expect(u.origin).toBe("https://acct.r2.cloudflarestorage.com");
    expect(u.pathname).toBe(`/media/${up.key}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(up.headers["content-type"]).toBe("image/png");
  });

  it("rejects SVG, empty and oversized files", async () => {
    await expect(presignImageUpload({ filename: "a.svg", contentType: "image/svg+xml", size: 10 })).rejects.toThrow(StorageError);
    await expect(presignImageUpload({ filename: "a.png", contentType: "image/png", size: 0 })).rejects.toThrow(/empty/);
    await expect(presignImageUpload({ filename: "a.png", contentType: "image/png", size: 5 * 1024 * 1024 })).rejects.toThrow(/1 MB or smaller/);
  });
});

describe("sanitiser + storage origin", () => {
  it("keeps http images only from the configured storage origin", () => {
    const html = '<img src="http://localhost:9000/b/a.png"><img src="http://evil.example/x.png"><img src="https://ok.example/y.png">';
    const out = sanitizeNotebookHtml(html, { imageOrigins: ["http://localhost:9000"] });
    expect(out).toContain('src="http://localhost:9000/b/a.png"');
    expect(out).not.toContain("evil.example");
    expect(out).toContain('src="https://ok.example/y.png"');
  });

  it("keeps figure captions", () => {
    const out = sanitizeNotebookHtml('<figure><img src="https://m.example/a.png" alt="A"><figcaption>Caption <script>x</script></figcaption></figure>');
    expect(out).toContain("<figure>");
    expect(out).toContain("<figcaption>Caption </figcaption>");
  });
});
