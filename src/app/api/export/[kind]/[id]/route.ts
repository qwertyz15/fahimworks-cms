import { EXPORT_FORMATS, fileNameFor, type ExportFormat } from "@/lib/export/document";
import { toMarkdown } from "@/lib/export/markdown";
import { AuthorizationError, requireAdmin } from "@/server/auth/guards";
import { toDocx } from "@/server/export/docx";
import { toHtml } from "@/server/export/html";
import { ExportNotFound, notebookSource, pageSource } from "@/server/export/source";

/**
 * GET /api/export/notebook/:id?format=md|docx|html (or /api/export/page/:id)
 * Downloads the entry / page. Admins only; always a download (never shown
 * inline on this origin), never cached.
 */

const TYPES: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8",
};

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const format = new URL(req.url).searchParams.get("format") as ExportFormat;
  if (!(EXPORT_FORMATS as readonly string[]).includes(format) || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || (kind !== "notebook" && kind !== "page")) {
    return new Response("Not found", { status: 404 });
  }
  let user;
  try {
    user = await requireAdmin("throw");
  } catch (err) {
    if (err instanceof AuthorizationError) return new Response("Sign in to export.", { status: 401 });
    throw err;
  }
  let source;
  try {
    source = kind === "notebook" ? await notebookSource(id) : await pageSource(user.id, id);
  } catch (err) {
    if (err instanceof ExportNotFound) return new Response("Not found", { status: 404 });
    throw err;
  }
  const body = format === "md" ? toMarkdown(source.doc, source.meta, source.ctx) : format === "html" ? toHtml(source.html, source.meta) : await toDocx(source.doc, source.meta, source.ctx);
  const name = fileNameFor(source.meta.title, format);
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
