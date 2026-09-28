import { describe, expect, it } from "vitest";
import { CONTENT_TYPES, IMPORT_TYPES, createContentSchema, saveEntrySchema, updateContentSchema } from "@/lib/validation";

const imported = { url: "https://example.com/post", title: "A post", description: "", summary: "", thumbnail: "", tags: "" };

describe("Notebook is its own type", () => {
  it("is a content type, but not one an imported item can have", () => {
    expect(CONTENT_TYPES).toContain("NOTEBOOK");
    expect(IMPORT_TYPES).not.toContain("NOTEBOOK");
  });
  it("imported items can't be created or edited as NOTEBOOK", () => {
    expect(createContentSchema.safeParse({ url: imported.url, type: "NOTEBOOK" }).success).toBe(false);
    expect(createContentSchema.safeParse({ url: imported.url, type: "PROJECT" }).success).toBe(true);
    expect(updateContentSchema.safeParse({ ...imported, id: "x1", type: "NOTEBOOK" }).success).toBe(false);
  });
  it("Notebook saves carry no type (the server always stores NOTEBOOK)", () => {
    const parsed = saveEntrySchema.parse({ title: "t", html: "<p>x</p>", body: { type: "doc", content: [] }, tags: "", type: "BLOG" });
    expect("type" in parsed).toBe(false);
  });
});
