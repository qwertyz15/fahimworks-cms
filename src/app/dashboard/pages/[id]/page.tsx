import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { PageScreen } from "@/components/database/page-screen";
import type { PropertyValue } from "@/lib/db-properties";
import { mediaUploadLimitBytes, uploadLimitBytes, uploadsEnabled } from "@/lib/storage";
import { requireAdmin } from "@/server/auth/guards";
import { DatabaseError, getPage } from "@/server/databases/service";

export const metadata: Metadata = { title: "Page" };

export default async function WorkspacePage({ params }: PageProps<"/dashboard/pages/[id]">) {
  const user = await requireAdmin();
  const { id } = await params;
  let data;
  try {
    data = await getPage(user.id, id);
  } catch (err) {
    if (err instanceof DatabaseError) notFound();
    throw err;
  }
  const { page, database } = data;
  return (
    <PageScreen
      key={page.id}
      page={{
        id: page.id,
        title: page.title,
        icon: page.icon,
        coverImage: page.coverImage,
        body: (page.body as JSONContent | null) ?? null,
        values: (page.values ?? {}) as Record<string, PropertyValue>,
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
      }}
      database={database ? { id: database.database.id, title: database.database.title, icon: database.database.icon } : null}
      properties={database?.properties ?? []}
      people={database?.people ?? []}
      uploads={{ enabled: uploadsEnabled(), maxBytes: uploadLimitBytes(), maxMediaBytes: mediaUploadLimitBytes() }}
    />
  );
}
