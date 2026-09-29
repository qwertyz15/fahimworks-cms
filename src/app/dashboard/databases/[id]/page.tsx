import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DatabaseScreen } from "@/components/database/database-screen";
import { localToday } from "@/lib/dates";
import { mediaUploadLimitBytes, uploadLimitBytes, uploadsEnabled } from "@/lib/storage";
import { requireAdmin } from "@/server/auth/guards";
import { DatabaseError, getDatabase, queryRows } from "@/server/databases/service";
import { writtenPostUrl } from "@/lib/timeline";

export const metadata: Metadata = { title: "Database" };

export default async function DatabasePage({ params, searchParams }: PageProps<"/dashboard/databases/[id]">) {
  const user = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  let data;
  try {
    data = await getDatabase(user.id, id);
  } catch (err) {
    if (err instanceof DatabaseError) notFound();
    throw err;
  }
  const view = data.views.find((v) => v.id === sp.view) ?? data.views[0]!;
  // The server's "today" is fine for the first render; the client re-queries with its own date.
  const { rows, total } = await queryRows(user.id, id, { filter: view.config.filter ?? null, sorts: view.config.sorts ?? [], today: localToday() });

  return (
    <DatabaseScreen
      key={id}
      database={{ id, title: data.database.title, description: data.database.description, icon: data.database.icon, coverImage: data.database.coverImage, archived: Boolean(data.database.archivedAt) }}
      properties={data.properties}
      views={data.views}
      people={data.people}
      rows={rows}
      total={total}
      activeViewId={view.id}
      articleBaseUrl={writtenPostUrl("")}
      peekId={typeof sp.p === "string" && /^[a-z0-9]{8,40}$/.test(sp.p) ? sp.p : null}
      uploads={{ enabled: uploadsEnabled(), maxBytes: uploadLimitBytes(), maxMediaBytes: mediaUploadLimitBytes() }}
    />
  );
}
