import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintView } from "@/components/export/print-view";
import { requireAdmin } from "@/server/auth/guards";
import { ExportNotFound, pageSource } from "@/server/export/source";

export const metadata: Metadata = { title: "Print" };

/** A database page laid out for Print → Save as PDF. */
export default async function PrintDatabasePage({ params }: PageProps<"/print/page/[id]">) {
  const user = await requireAdmin();
  const { id } = await params;
  const source = await pageSource(user.id, id).catch((err) => {
    if (err instanceof ExportNotFound) return null;
    throw err;
  });
  if (!source) notFound();
  return <PrintView meta={source.meta} html={source.html} />;
}
